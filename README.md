# Distributed Wagering Processor

Serviço financeiro para processar apostas com precisão decimal, idempotência persistente, ledger auditável e recuperação segura de falhas em um ambiente distribuído.

O enunciado original está preservado em [CHALLENGE.md](./CHALLENGE.md).

## O que a solução entrega

- NestJS, Bun, TypeScript estrito, PostgreSQL, MikroORM e Docker Compose;
- valores monetários com `Decimal`, recebidos e retornados como strings com duas casas decimais;
- uma wallet por jogador e moeda, com saldo não negativo garantido também pelo PostgreSQL;
- transações `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`;
- ledger append-only, com triggers que impedem alteração e exclusão;
- idempotência persistente por `Idempotency-Key` e detecção de payload divergente;
- lock pessimista por wallet para evitar lost updates;
- inbox persistente, transactional outbox, SQS FIFO no LocalStack, retries e DLQ;
- worker, publisher e reprocessador de referências como processos independentes;
- logs JSON, health checks e métricas Prometheus em `/metrics`;
- Swagger em `/docs`.

## Arquitetura

```text
Swagger / cliente HTTP
          |
          v
       API NestJS --------------------> PostgreSQL
          |                               | wallets, transações, ledger,
          |                               | inbox e outbox
          |                               v
          |                           Outbox Publisher
          |                               |
          v                               v
    LocalStack / SQS <---------------- eventos confirmados
          |
          v
        Worker -----> mesmo caso de uso financeiro
          |
          v
  Reference Reprocessor (REFUND/ROLLBACK fora de ordem)
```

API, worker, publisher e reprocessador usam o mesmo código de domínio, mas executam como processos separados. Isso permite escalar consumidores e publishers sem transformar as regras financeiras em microserviços independentes.

Mais detalhes e decisões estão em [ARCHITECTURE.md](./ARCHITECTURE.md).

## Subir o ambiente

### Pré-requisitos

- Docker Desktop;
- Bun 1.4 ou compatível, apenas para executar comandos no host;
- portas `3000`, `5432` e `4566` disponíveis.

### Ambiente completo local

```powershell
Copy-Item .env.example .env
docker compose --profile worker --profile publisher --profile reference-reprocessor --profile observability up -d --build
docker compose exec api bun run migration:up
```

O primeiro comando sobe PostgreSQL, LocalStack, API, consumer SQS, publisher da outbox, reprocessador de referências, Prometheus e Grafana.

| Recurso | Endereço |
|---|---|
| Swagger | http://localhost:3000/docs |
| OpenAPI JSON | http://localhost:3000/docs-json |
| Liveness | http://localhost:3000/health/live |
| Readiness | http://localhost:3000/health/ready |
| Métricas da API | http://localhost:3000/metrics |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (credenciais locais: `admin` / `admin`) |

Para acompanhar a execução:

```powershell
docker compose logs -f api worker publisher reference-reprocessor
```

Para encerrar os containers:

```powershell
docker compose down
```

## Fluxo para demonstrar no Swagger

1. Crie uma wallet com saldo inicial `100.00 BRL` em `POST /wallets`.
2. Copie o `id` retornado como `walletId`.
3. Em `POST /wagering/transactions`, use o mesmo `playerId`, um `providerId` fixo e identificadores novos para a operação:

```text
providerId: provider-demo
externalTransactionId: bet-demo-001
Idempotency-Key: provider-demo:bet-demo-001
```

4. Envie uma `BET` de `25.00`. O saldo passa para `75.00` e há um lançamento `DEBIT` no ledger.
5. Reenvie exatamente a mesma requisição com a mesma idempotency key. A resposta deve conter `idempotentReplay: true`, sem novo débito.
6. Para uma nova aposta, mantenha o `providerId`, mas troque `externalTransactionId` e `Idempotency-Key`.
7. Envie uma aposta maior que o saldo. Ela é registrada como `REJECTED` com `INSUFFICIENT_FUNDS`, mas não muda saldo nem gera ledger.
8. Consulte `GET /wallets/:walletId/ledger?limit=50` e `POST /wallets/:walletId/reconciliation`.

Uma transação válida, porém rejeitada por regra de negócio, é persistida para auditoria e para que um retry futuro devolva a mesma decisão. Um payload malformado recebe `400` e não é persistido.

## API principal

| Método | Rota | Finalidade |
|---|---|---|
| `POST` | `/wallets` | Cria wallet e lançamento interno `OPENING`. |
| `GET` | `/wallets` | Lista wallets para consulta operacional. |
| `GET` | `/wallets/:walletId` | Consulta saldo materializado. |
| `GET` | `/wallets/:walletId/ledger` | Lista o ledger com cursor estável. |
| `POST` | `/wallets/:walletId/reconciliation` | Compara saldo persistido com o saldo reconstruído pelo ledger, sem corrigir dados. |
| `POST` | `/wagering/transactions` | Submete transação financeira. |
| `GET` | `/wagering/transactions/:transactionId` | Busca transação pelo UUID interno. |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Busca pela identidade do provedor. |

### Paginação do ledger

`GET /wallets/:walletId/ledger?limit=50&cursor=...` ordena lançamentos do mais recente para o mais antigo por `createdAt` e `id`.

`nextCursor` é um token de continuação: copie-o exatamente na próxima requisição e não tente montá-lo manualmente. Isso evita repetição ou salto de itens quando novos lançamentos entram entre duas páginas.

## Garantias financeiras

- dinheiro nunca é tratado como `number` ou ponto flutuante;
- operações da mesma wallet usam `FOR UPDATE`, enquanto wallets diferentes continuam independentes;
- saldo, transação, ledger, inbox e outbox são persistidos na mesma transação SQL quando aplicável;
- a idempotência é banco de dados, não memória do processo;
- a inbox impede um segundo efeito financeiro após redelivery SQS;
- o ack SQS acontece após o commit;
- a outbox só é publicada depois do commit e pode ser retomada por outro publisher;
- `REJECTED` não altera saldo nem cria ledger;
- a reconciliação expõe divergência, registra log/métrica e nunca corrige dados silenciosamente.

## Processos e escala local

| Processo | Comando | Responsabilidade |
|---|---|---|
| API | `bun run start` | HTTP, Swagger e consultas. |
| Worker | `bun run start:worker` | Consome transações do SQS. |
| Publisher | `bun run start:publisher` | Publica mensagens pendentes da outbox. |
| Reprocessador | `bun run start:reference-reprocessor` | Resolve referências pendentes. |

Para executar três workers da aplicação local:

```powershell
docker compose --profile worker up -d --scale worker=3
```

## Configuração

Copie `.env.example` para `.env`. As variáveis mais importantes são:

| Variável | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL da aplicação. |
| `SQS_ENDPOINT` | LocalStack local ou endpoint AWS real. |
| `WAGER_TRANSACTIONS_QUEUE_URL` | Fila FIFO de transações. |
| `WAGER_TRANSACTIONS_DLQ_URL` | Fila de mensagens problemáticas. |
| `WAGER_EVENTS_QUEUE_URL` | Fila de eventos publicados pela outbox. |
| `PENDING_REFERENCE_*` | Backoff, limite e polling de referências pendentes. |
| `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` | Credenciais do dashboard local; altere antes de expor fora da máquina. |

Para AWS real, mantenha a mesma interface e altere endpoint, URLs de filas, região e credenciais. O código não depende do LocalStack.

## Testes

### Unitários

```powershell
bun run test:unit
```

### Integração com PostgreSQL e LocalStack reais

Com os containers de teste ativos, configure as variáveis de `.env.example` e execute:

```powershell
$env:RUN_INTEGRATION_TESTS='true'
$env:TEST_DATABASE_URL='postgresql://wagering:wagering@localhost:5433/wagering_test'
$env:TEST_WAGER_TRANSACTIONS_QUEUE_URL='http://localhost:4566/000000000000/wager-transactions-test.fifo'
$env:TEST_WAGER_TRANSACTIONS_DLQ_URL='http://localhost:4566/000000000000/wager-transactions-test-dlq.fifo'
$env:TEST_WAGER_EVENTS_QUEUE_URL='http://localhost:4566/000000000000/wager-events-test.fifo'
bun run migration:up
bun run test:integration
```

### Três workers Docker

```powershell
bun run test:distributed-workers
```

O teste distribuído sobe três containers `worker-test` e prova que:

- wallets diferentes são processadas em paralelo;
- duas apostas simultâneas de `80.00` para o saldo `100.00` resultam em uma `PROCESSED`, uma `REJECTED`, saldo `20.00` e um único débito no ledger.

Os testes também cobrem 50 cópias paralelas da mesma aposta, redelivery após commit antes do ack, publishers concorrentes, publisher retomando mensagens já confirmadas no banco, referências fora de ordem e DLQ para payload inválido.

### Teste de carga local

```powershell
bun run test:load
```

O teste cria wallets exclusivas e dispara apostas concorrentes contra a API local. Ele imprime e salva throughput, p50/p95/p99, taxa de erro, conflitos HTTP inesperados, resultado da disputa de hot wallet, reconciliação e atraso da outbox. Consulte [docs/load-testing.md](./docs/load-testing.md) para preparar o ambiente, ajustar a carga e interpretar os números sem extrapolar resultados locais para produção. Uma execução de referência está em [docs/load-test-result.md](./docs/load-test-result.md).

## Observabilidade

Logs de negócio são JSON e evitam payloads financeiros completos. As métricas cobrem transações por status, duplicatas, retries, DLQ, locks, latência, atraso da outbox e divergências de reconciliação.

Cada processo possui sua própria rota `/metrics`. A API publica em `3000`; worker, publisher e reprocessador expõem a porta interna `9464` de cada container. O perfil Docker `observability` sobe Prometheus em `9090` e Grafana em `3001`; o dashboard **Distributed Wagering Overview** e a fonte Prometheus são provisionados automaticamente a partir dos arquivos versionados em `docker/`.

## Limitações e evoluções futuras

- autenticação não foi implementada porque não pontua no desafio; em produção seria integrada a um IdP OIDC, sem usuários ou senhas próprios;
- OpenTelemetry e Jaeger não foram adicionados; as métricas, Prometheus e Grafana já permitem observação por métricas, enquanto tracing distribuído continua como evolução futura;
- o cursor do ledger é estável para paginação, mas não é um token criptograficamente assinado;
- o lock pessimista prioriza correção da hot wallet; para volume muito alto, a estratégia de claim/lease da outbox e particionamento podem evoluir.
