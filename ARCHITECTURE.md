# Arquitetura

Este documento registra as decisões do Distributed Wagering Processor. Ele evolui junto com a implementação: cada decisão relevante é documentada aqui quando a capacidade relacionada é adicionada e validada.

## Limites atuais do sistema

```text
Clientes HTTP ─┐
                ├── Aplicação NestJS ── PostgreSQL
Workers SQS ───┘           │
                           └── Amazon SQS (LocalStack localmente)
```

Atualmente a aplicação expõe endpoints de liveness e readiness e publica um documento OpenAPI pelo Swagger. PostgreSQL e SQS são verificados separadamente da liveness para que o orquestrador não direcione tráfego a uma aplicação incapaz de processar trabalho financeiro.

## ADR-001: Monólito modular

### Status

Aceita.

### Contexto

O desafio exige processamento distribuído, mas o prazo de entrega é curto e as regras financeiras compartilham uma mesma fronteira transacional.

### Decisão

Usar uma aplicação NestJS organizada em módulos de negócio. Wallet, wagering, mensageria, health e observabilidade permanecem separados dentro da mesma unidade implantável.

### Consequências

- Alterações financeiras podem ser confirmadas atomicamente em uma transação PostgreSQL.
- Os módulos mantêm responsabilidades claras sem o custo operacional de múltiplos deploys.
- Os workers rodarão como processos separados a partir do mesmo código quando o processamento concorrente for introduzido.

## ADR-002: Bun e TypeScript estrito

### Status

Aceita.

### Contexto

Bun 1.x e TypeScript estrito são obrigatórios no desafio.

### Decisão

Usar Bun 1.4 como runtime, gerenciador de pacotes e executor de testes. As dependências são fixadas no `package.json` e resolvidas no `bun.lock`. A checagem de tipos e o lint rodam por scripts dedicados.

### Consequências

- Desenvolvimento local e CI usam o mesmo gerenciador de pacotes e lockfile.
- O projeto detecta erros de tipo antes da execução.
- Premissas específicas de Node.js precisam ser validadas contra Bun durante a implementação.

## ADR-003: PostgreSQL e MikroORM

### Status

Aceita.

### Contexto

O desafio exige PostgreSQL, migrations versionadas e reversíveis, e prefere MikroORM. A correção financeira deve continuar válida entre múltiplas instâncias da aplicação.

### Decisão

Usar PostgreSQL 17 e MikroORM 7. O ORM é configurado com caminhos separados para entidades TypeScript durante o desenvolvimento e entidades JavaScript compiladas em runtime. Alterações no schema serão introduzidas apenas por migrations reversíveis.

### Consequências

- PostgreSQL será responsável pelas garantias de unicidade, saldo não negativo e imutabilidade do ledger, por meio de constraints e triggers.
- MikroORM fornecerá fronteiras transacionais, identity maps por requisição e locks em nível de linha.
- O modelo de domínio não dependerá de decorators do ORM.

## ADR-004: SQS local com LocalStack

### Status

Aceita.

### Contexto

O sistema precisa de uma fila compatível com SQS para testes locais de integração e concorrência, sem exigir credenciais AWS.

### Decisão

Usar LocalStack no Docker Compose. O ambiente local inicializa uma fila FIFO de entrada, sua DLQ e uma fila FIFO de eventos. A aplicação recebe o endpoint e as URLs das filas por variáveis de ambiente.

### Consequências

- Testes de integração exercitam localmente a semântica real de filas.
- O AWS SDK continua sendo o cliente; portanto, o SQS de produção pode ser configurado sem alterar o fluxo da aplicação.
- A ordenação FIFO é tratada como otimização; as invariantes no banco continuam obrigatórias.

## ADR-005: Autenticação adiada com fronteira explícita

### Status

Aceita para a entrega do desafio.

### Contexto

A autenticação explicitamente não pontua e não deve reduzir o tempo disponível para correção financeira, idempotência, concorrência ou recuperação.

### Decisão

Não criar um sistema local de usuário e senha. Introduzir uma `ProviderIdentityPort` quando os endpoints de wagering forem implementados, inicialmente atendida por um adaptador no-op. Um adaptador de produção validaria a identidade do provedor por meio de um Identity Provider OIDC externo, usando client credentials.

### Consequências

- Endpoints de health permanecem públicos.
- Mensagens da fila são um canal interno confiável, mas seus provider IDs ainda passam por validação de domínio.
- A autenticação pode ser adicionada depois sem alterar os casos de uso financeiros.

## ADR-006: Valores monetários exatos e imutáveis

### Status

Aceita.

### Contexto

Valores monetários não podem usar `number`, pois a representação binária de ponto flutuante produz imprecisões, como `0.10 + 0.20` não resultar de forma confiável em `0.30`.

### Decisão

Representar dinheiro pela classe de domínio imutável `Money`, apoiada por `decimal.js`. Os contratos externos recebem e serializam valores como strings decimais não negativas com exatamente duas casas, por exemplo `"25.00"`. Operações entre moedas diferentes lançam erro de domínio.

### Consequências

- Cada operação retorna um novo `Money`; valores anteriores não são alterados.
- Notação científica, negativos, valores sem duas casas e valores não finitos são rejeitados na entrada.
- Resultados internos negativos podem existir temporariamente para cálculos, como uma subtração ou negação; regras de wallet impedirão que saldo persistido se torne negativo.
- A persistência futura usará `numeric(18,2)` no PostgreSQL e nunca converterá valores para `number`.

## ADR-007: Wallet como dona do saldo materializado

### Status

Aceita.

### Contexto

O sistema precisa consultar saldo rapidamente, mas não pode permitir saldo negativo, moeda divergente ou atualização parcial do estado. Cada mudança de saldo também precisará gerar um lançamento auditável no ledger.

### Decisão

Modelar `Wallet` como aggregate root com saldo, moeda e versão encapsulados. Os métodos `credit` e `debit` validam a moeda e retornam um `WalletBalanceChange` com direção, saldo anterior, saldo posterior e nova versão. Débitos que deixariam o saldo negativo falham antes de alterar o estado.

### Consequências

- A versão começa em 1 e só é incrementada quando o saldo muda.
- Uma movimentação de valor zero é rejeitada, pois não deve gerar lançamento no ledger.
- A Wallet permanece independente de banco e filas; o caso de uso futuro fará a alteração da wallet e a criação do ledger na mesma transação SQL.
- `rehydrate` reconstrói estado já persistido sem aplicar uma nova transição de negócio.

## ADR-008: Ledger imutável com evidência de saldo

### Status

Aceita.

### Contexto

O saldo atual da wallet responde quanto um jogador possui agora, mas sozinho não explica como aquele valor foi alcançado. O desafio exige um ledger imutável para auditoria e reconciliação financeira.

### Decisão

Representar cada movimentação por um `WalletLedgerEntry` com a carteira, a transação que a causou, direção (`CREDIT` ou `DEBIT`), valor movimentado, saldo anterior, saldo posterior e momento do lançamento. A entrada só pode ser criada se todas as moedas coincidirem, o valor for estritamente positivo, nenhum saldo for negativo e a aritmética estiver correta para a direção. A classe não expõe métodos de edição ou remoção.

### Consequências

- Um crédito precisa obedecer `saldo posterior = saldo anterior + valor`; um débito precisa obedecer `saldo posterior = saldo anterior - valor`.
- Um lançamento fornece evidência suficiente para auditoria sem reconstruir o histórico inteiro.
- Na persistência, uma migration acrescentará uma tabela append-only e o banco impedirá `UPDATE` e `DELETE`.
- O caso de uso futuro criará a alteração de wallet e o lançamento de ledger na mesma transação SQL.

## ADR-009: Transação de wagering como máquina de estados

### Status

Aceita.

### Contexto

Uma mensagem de provedor não é apenas uma alteração de saldo: ela possui identidade externa, idempotência, tipo de operação, possível referência a outra operação e um ciclo de vida auditável. Mensagens podem chegar duplicadas ou fora de ordem.

### Decisão

Modelar `WagerTransaction` como a fonte de verdade para o ciclo de vida de `OPENING`, `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`. Toda transação nasce em `PENDING`; uma reversão cuja referência ainda não chegou vai para `PENDING_REFERENCE`; `PROCESSED`, `REJECTED` e `FAILED` são terminais. `REFUND` e `ROLLBACK` exigem referência; `WIN` pode opcionalmente apontar para a `BET` da mesma rodada. A referência precisa pertencer ao mesmo provider, jogador, wallet, rodada, moeda e valor, e já estar processada.

### Consequências

- `BET` gera débito; `WIN`, `REFUND` e `OPENING` geram crédito; `LOSS` não altera saldo; `ROLLBACK` usa a direção inversa da transação referenciada.
- As regras de tipo de referência impedem refund de uma vitória e rollback de uma operação sem efeito financeiro.
- A classe conhece o `payloadHash`, mas a garantia de idempotência será concluída com índice único e consulta persistente no caso de uso.
- `OPENING` permanece permitido no domínio para a criação interna da wallet; os adaptadores HTTP e SQS o bloquearão como entrada externa.

## ADR-010: Schema financeiro como última linha de defesa

### Status

Aceita.

### Contexto

Validações no domínio tornam regras legíveis, mas não protegem contra bugs de aplicação, acesso concorrente de múltiplas instâncias ou escrita direta no banco. O desafio exige que unicidade, não negatividade e imutabilidade também sejam garantidas pelo schema PostgreSQL.

### Decisão

Mapear a persistência com `EntitySchema` do MikroORM, mantendo classes de domínio livres de decorators. A migration inicial cria `wallets`, `wager_transactions` e `wallet_ledger_entries` com valores `numeric(18,2)`, timestamps com timezone, chaves estrangeiras e índices orientados às consultas previstas. O banco aplica unicidade de wallet e idempotência, contexto comum entre wallet/transação/ledger, valores e saldos válidos, e aritmética do ledger. Triggers bloqueiam `UPDATE` e `DELETE` em lançamentos do ledger e exigem uma transação processada que afete saldo, com direção coerente para os tipos não ambíguos.

### Consequências

- Uma tentativa de gravar ledger cuja conta não fecha falha mesmo que o chamador ignore as classes de domínio.
- Uma transação não pode apontar para wallet, jogador ou moeda incompatíveis; um ledger também não pode ser associado a uma wallet diferente da sua transação.
- O modelo de persistência pode evoluir sem contaminar `Money`, `Wallet`, `WagerTransaction` ou `WalletLedgerEntry` com detalhes do ORM.
- Inbox, outbox e a estratégia de lock por wallet entrarão em migrations posteriores, antes do caso de uso financeiro distribuído.

## Próximas decisões a registrar

- Idempotency key e algoritmo de hash de payload canônico.
- Estratégia de concorrência por wallet e constraints do banco.
- Inbox, Outbox transacional, retries, referências pendentes e comportamento da DLQ.
- Mapeamento de erros HTTP, logs estruturados, métricas e estratégia de testes.

## ADR-011: Transação SQL e lock pessimista por wallet

### Status

Aceita.

### Contexto

Dois pedidos podem tentar movimentar a mesma carteira quase ao mesmo tempo. Se ambos lessem o mesmo saldo antes de gravar, poderiam aprovar débitos que, juntos, deixam o jogador com saldo negativo. Também precisamos garantir que a alteração de saldo, a transação de wagering e o ledger não existam parcialmente.

### Decisão

O caso de uso financeiro executa em uma única transação SQL. Depois de uma primeira consulta rápida por idempotency key, ele obtém a wallet com lock pessimista de escrita (`FOR UPDATE`) e consulta a chave novamente. Assim, operações para a mesma carteira são serializadas, enquanto carteiras diferentes continuam independentes. A wallet, a `WagerTransaction` e seu `WalletLedgerEntry` são gravados antes do commit da mesma transação; o ledger é enviado ao banco depois da transação porque sua chave estrangeira exige que ela já exista.

### Consequências

- Se falhar a criação do ledger, também são desfeitos o saldo e a transação de wagering; o primeiro `flush` ainda não é um commit.
- A segunda consulta de idempotência depois do lock evita que duas requisições concorrentes da mesma wallet apliquem a mesma operação duas vezes. O índice único permanece como proteção final no banco.
- A versão da wallet continua sendo evidência de quantas alterações de saldo ocorreram, mas a exclusão mútua deste fluxo vem do lock pessimista, não de uma tentativa otimista do ORM.
- Uma wallet muito movimentada pode ter pequenas esperas entre operações concorrentes, uma escolha deliberada para priorizar correção financeira neste desafio.

## ADR-012: Inbox persistente e transactional outbox

### Status

Aceita.

### Contexto

O SQS entrega mensagens pelo menos uma vez e a aplicação pode morrer depois de confirmar uma alteração financeira, mas antes de publicar o evento correspondente. Depender apenas da memória do processo ou publicar diretamente antes do commit causaria duplicidade ou perda de eventos.

### Decisão

Criar `inbox_messages` com unicidade por `(consumer_name, message_id)` para que o futuro worker reconheça redeliveries. Criar `outbox_messages` com envelope JSON versionado, tentativas, próximo agendamento e marca de publicação. O caso de uso já grava os eventos de transação e de mudança de saldo na outbox na mesma transação SQL de wallet, wager transaction e ledger. O publisher SQS será um processo posterior que selecionará apenas mensagens pendentes.

### Consequências

- Um commit financeiro não pode existir sem seus eventos pendentes; se o processo morrer, outro publisher poderá enviá-los depois.
- A outbox aceita aggregates diferentes: `WagerTransactionProcessed` pertence à transação, enquanto `WalletBalanceChanged` pertence à wallet. Por isso `aggregate_id` é indexável, mas não tem chave estrangeira para uma única tabela.
- A publicação continuará sendo ao menos uma vez; consumidores precisam usar event id ou inbox para tolerar uma eventual publicação duplicada.
- Nesta etapa a inbox ainda não é preenchida, pois isso pertence ao worker SQS. Sua tabela e regras já existem para evitar que a deduplicação seja uma decisão tardia.
