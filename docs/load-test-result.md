# Resultado de referência do teste de carga local

Esta é uma execução de referência do comando `bun run test:load`. Ela serve para demonstrar metodologia e comportamento sob carga na stack local; não é benchmark de produção nem meta de RPS.

## Ambiente

| Item | Valor |
|---|---|
| Data da execução | 05/09/2026, 13:36 BRT |
| Host | Windows (`win32`) com Docker Desktop |
| Runtime | Bun 1.4.0 |
| Topologia | uma API NestJS, PostgreSQL, LocalStack e publisher em Docker Compose local |
| API | `http://localhost:3000` |

## Metodologia

- 100 `BET`s únicas de `1.00 BRL` contra uma mesma wallet, com saldo inicial `101.00 BRL`;
- concorrência máxima de 20 requisições HTTP;
- cada operação possui `externalTransactionId` e `Idempotency-Key` próprios;
- depois do throughput, duas `BET`s de `80.00 BRL` concorrem por uma wallet de `100.00 BRL`;
- o script reconcilia o ledger e consulta no PostgreSQL a outbox relacionada à wallet da execução.

## Resultado

| Métrica | Valor |
|---|---:|
| Throughput | 20,33 requisições/s |
| Duração de 100 requisições | 4.917,99 ms |
| p50 | 919,03 ms |
| p95 | 1.132,04 ms |
| p99 | 1.132,48 ms |
| Processadas | 100 |
| Rejeitadas no cenário de throughput | 0 |
| Erros HTTP/rede | 0 |
| Replays idempotentes | 0 |
| Conflitos HTTP inesperados | 0 |
| Saldo esperado / armazenado | `1.00` / `1.00` |
| Reconciliação principal | consistente |
| Disputa da hot wallet | 1 `PROCESSED`, 1 `REJECTED`, saldo `20.00`, consistente |
| Outbox: lag após espera inicial | 4,59 s |
| Outbox: tempo adicional até drenar | 1.981,54 ms |

O atraso observado na outbox é esperado em uma carga em rajada: a transação financeira é confirmada primeiro e o publisher a esvazia de forma assíncrona. Nesta execução, a outbox relacionada à carga drenou dentro do timeout de 10 s e nenhum evento foi perdido. O arquivo bruto da última execução fica em `artifacts/load-test-report.json`, ignorado pelo Git por ser específico de ambiente.
