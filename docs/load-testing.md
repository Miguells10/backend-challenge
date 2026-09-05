# Teste de carga local

`bun run test:load` é um experimento de carga reproduzível. Ele não substitui os testes de integração ou os testes distribuídos: mede o comportamento da stack local e ainda verifica invariantes financeiros depois da carga.

## Cenário

1. Confere a liveness da API.
2. Cria uma wallet exclusiva, com saldo suficiente para a carga.
3. Envia `BET`s únicos e concorrentes para essa mesma hot wallet.
4. Cria uma segunda hot wallet e envia duas apostas de `80.00` em paralelo, comprovando que somente uma é processada e a outra é rejeitada.
5. Reconcilia o ledger da wallet principal e consulta, diretamente no PostgreSQL, o atraso de mensagens da outbox relacionadas às wallets desta execução depois de uma pequena espera pelo publisher.

Cada requisição de carga tem `externalTransactionId` e `Idempotency-Key` exclusivos. Portanto, `idempotentReplays` deve ficar em zero nesse cenário: ele mede throughput de operações novas, não deduplicação. A idempotência concorrente é comprovada pelos testes de integração.

## Preparação e execução

Use o ambiente completo, inclusive o publisher:

```powershell
docker compose --profile worker --profile publisher --profile reference-reprocessor up -d --build
docker compose exec api bun run migration:up
bun run test:load
```

O comando grava o relatório da execução em `artifacts/load-test-report.json`. Essa pasta é ignorada pelo Git porque cada execução depende da máquina e do estado local.

## Configuração

| Variável | Padrão | Significado |
|---|---:|---|
| `LOAD_TEST_BASE_URL` | `http://localhost:3000` | Endereço da API alvo. |
| `LOAD_TEST_REQUESTS` | `100` | Quantidade de apostas únicas do cenário de throughput. |
| `LOAD_TEST_CONCURRENCY` | `20` | Máximo de requisições simultâneas. |
| `LOAD_TEST_BET_AMOUNT` | `1.00` | Valor de cada aposta do cenário principal. |
| `LOAD_TEST_INITIAL_BALANCE` | suficiente para todas as apostas | Saldo inicial da wallet principal. |
| `LOAD_TEST_OUTBOX_WAIT_MS` | `1500` | Espera antes de medir itens ainda pendentes na outbox. |
| `LOAD_TEST_OUTBOX_DRAIN_TIMEOUT_MS` | `10000` | Tempo máximo para observar a drenagem posterior da outbox. |

Exemplo com carga um pouco maior:

```powershell
$env:LOAD_TEST_REQUESTS='500'
$env:LOAD_TEST_CONCURRENCY='50'
bun run test:load
```

## Como interpretar o relatório

- `requestsPerSecond`, `p50`, `p95` e `p99` descrevem somente esta execução local, incluindo Docker Desktop e a máquina que a rodou. Não são uma promessa de capacidade de produção.
- `httpErrors` conta respostas HTTP de erro e falhas de rede. O resultado esperado é `0`.
- `unexpectedHttpConflicts` conta respostas `409` no cenário de operações únicas. O resultado esperado é `0`.
- `hotWallet` precisa terminar com uma `PROCESSED`, uma `REJECTED`, saldo `20.00` e reconciliação consistente. Isso evidencia que a disputa não cria saldo negativo nem débito duplicado.
- `outbox.lagSecondsAfterWait` mede, no PostgreSQL, a idade da mensagem não publicada mais antiga após a espera inicial. `outbox.drainedAfterMs` mostra quanto tempo adicional a outbox precisou para ficar vazia. `null` indica que o diagnóstico via Docker não estava disponível ou que a fila não drenou até o timeout.

O script falha se a carga principal não processar todas as apostas, se houver erro HTTP, se o saldo não reconciliar, ou se a disputa da hot wallet quebrar a regra esperada.
