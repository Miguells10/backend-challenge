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

## Próximas decisões a registrar

- Representação exata de `Money` e validação de entrada.
- Modelo de wallet, ledger imutável e reconciliação.
- Idempotency key e algoritmo de hash de payload canônico.
- Estratégia de concorrência por wallet e constraints do banco.
- Inbox, Outbox transacional, retries, referências pendentes e comportamento da DLQ.
- Mapeamento de erros HTTP, logs estruturados, métricas e estratégia de testes.
