import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case';
import { pendingReferenceRetryPolicyFromEnvironment } from '../../src/config/pending-reference-retry-policy';
import { Money } from '../../src/domain/money/money';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction';
import { WalletEntitySchema } from '../../src/infrastructure/persistence/entities/wallet.entity';
import mikroOrmConfig from '../../mikro-orm.config';

const describeIntegration = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
const WALLET_ID = '00000000-0000-0000-0000-000000000501';
const PLAYER_ID = '00000000-0000-0000-0000-000000000502';

describeIntegration('PostgreSQL financial constraints', () => {
  let orm: MikroORM;
  let testEm: typeof orm.em;
  let useCase: ProcessWagerTransactionUseCase;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    useCase = new ProcessWagerTransactionUseCase(orm, pendingReferenceRetryPolicyFromEnvironment({}));
  });

  beforeEach(async () => {
    testEm = orm.em.fork();
    await testEm.getConnection().execute('truncate table outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
    testEm.persist(testEm.create(WalletEntitySchema, {
      id: WALLET_ID,
      playerId: PLAYER_ID,
      currency: 'BRL',
      balanceAmount: '100.00',
      version: 1,
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      updatedAt: new Date('2026-09-05T12:00:00.000Z'),
    }));
    await testEm.flush();
    await useCase.execute({
      id: '00000000-0000-0000-0000-000000000503',
      providerId: 'provider-constraints',
      externalTransactionId: 'bet-constraints-1',
      idempotencyKey: 'provider-constraints:bet-constraints-1',
      payloadHash: 'payload-hash-constraints-1',
      walletId: WALLET_ID,
      playerId: PLAYER_ID,
      roundId: 'round-constraints',
      gameId: 'game-constraints',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      occurredAt: new Date('2026-09-05T12:00:00.000Z'),
    });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('enforces non-negative balances and immutable ledger entries outside the application', async () => {
    await expect(testEm.getConnection().execute(
      'update "wallets" set "balance_amount" = -0.01 where "id" = ?',
      [WALLET_ID],
    )).rejects.toThrow();
    await expect(testEm.getConnection().execute(
      'update "wallet_ledger_entries" set "amount" = 10.00 where "wallet_id" = ?',
      [WALLET_ID],
    )).rejects.toThrow('wallet ledger entries are immutable');
    await expect(testEm.getConnection().execute(
      'delete from "wallet_ledger_entries" where "wallet_id" = ?',
      [WALLET_ID],
    )).rejects.toThrow('wallet ledger entries are immutable');
  });

  test('allows only one processed reversal of each kind for the same reference outside the application', async () => {
    const reference = await testEm.getConnection().execute<{ id: string }[]>(
      'select "id" from "wager_transactions" where "external_transaction_id" = ?',
      ['bet-constraints-1'],
    );
    const referenceId = reference[0]?.id;
    if (referenceId === undefined) throw new Error('Expected the processed bet reference.');

    const insertProcessedRefund = (id: string, externalTransactionId: string, idempotencyKey: string) =>
      testEm.getConnection().execute(
        `insert into "wager_transactions" (
          "id", "provider_id", "external_transaction_id", "idempotency_key", "payload_hash",
          "wallet_id", "player_id", "round_id", "game_id", "kind", "amount", "currency",
          "reference_external_transaction_id", "reference_transaction_id", "status", "result_balance_amount",
          "reference_attempts", "created_at", "processed_at"
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REFUND', 25.00, 'BRL', ?, ?, 'PROCESSED', 100.00, 0, now(), now())`,
        [
          id,
          'provider-constraints',
          externalTransactionId,
          idempotencyKey,
          `hash-${id}`,
          WALLET_ID,
          PLAYER_ID,
          'round-constraints',
          'game-constraints',
          'bet-constraints-1',
          referenceId,
        ],
      );

    await insertProcessedRefund(
      '00000000-0000-0000-0000-000000000504',
      'refund-constraints-1',
      'provider-constraints:refund-constraints-1',
    );

    await expect(insertProcessedRefund(
      '00000000-0000-0000-0000-000000000505',
      'refund-constraints-2',
      'provider-constraints:refund-constraints-2',
    )).rejects.toThrow('wager_transactions_processed_reversal_once_per_kind_unique');
  });
});
