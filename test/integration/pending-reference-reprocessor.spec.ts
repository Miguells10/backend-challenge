import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case';
import { pendingReferenceRetryPolicyFromEnvironment } from '../../src/config/pending-reference-retry-policy';
import { Money } from '../../src/domain/money/money';
import { WagerFailureCode, WagerTransactionKind, WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction';
import { WagerTransactionEntitySchema } from '../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntitySchema } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntitySchema } from '../../src/infrastructure/persistence/entities/wallet.entity';
import { PendingReferenceReprocessor } from '../../src/wagering/pending-reference-reprocessor';
import mikroOrmConfig from '../../mikro-orm.config';

const describeIntegration = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
const WALLET_ID = '00000000-0000-0000-0000-000000000101';
const PLAYER_ID = '00000000-0000-0000-0000-000000000102';
const INITIAL_TIME = new Date('2026-09-04T22:00:00.000Z');

describeIntegration('PendingReferenceReprocessor', () => {
  let orm: MikroORM;
  let testEm: typeof orm.em;
  let useCase: ProcessWagerTransactionUseCase;
  let reprocessor: PendingReferenceReprocessor;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    const retryPolicy = pendingReferenceRetryPolicyFromEnvironment({});
    useCase = new ProcessWagerTransactionUseCase(orm, retryPolicy);
    reprocessor = new PendingReferenceReprocessor(orm, useCase, retryPolicy);
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
      createdAt: INITIAL_TIME,
      updatedAt: INITIAL_TIME,
    }));
    await testEm.flush();
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('processes a refund after its referenced bet arrives later', async () => {
    const refund = await useCase.execute(command({
      id: '00000000-0000-0000-0000-000000000201',
      externalTransactionId: 'refund-1',
      idempotencyKey: 'provider-1:refund-1',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-1',
    }));
    await useCase.execute(command({ externalTransactionId: 'bet-1', idempotencyKey: 'provider-1:bet-1' }));

    await Promise.all([
      reprocessor.reprocessDue(new Date(INITIAL_TIME.getTime() + 6_000)),
      reprocessor.reprocessDue(new Date(INITIAL_TIME.getTime() + 6_000)),
    ]);
    testEm.clear();

    const wallet = await testEm.findOneOrFail(WalletEntitySchema, WALLET_ID);
    const persistedRefund = await testEm.findOneOrFail(WagerTransactionEntitySchema, refund.transactionId);
    const ledgerEntries = await testEm.count(WalletLedgerEntryEntitySchema, { walletId: WALLET_ID });

    expect(persistedRefund.status).toBe(WagerTransactionStatus.Processed);
    expect(wallet.balanceAmount).toBe('100.00');
    expect(ledgerEntries).toBe(2);
  });

  test('rejects a missing reference after the retry limit', async () => {
    const refund = await useCase.execute(command({
      id: '00000000-0000-0000-0000-000000000201',
      externalTransactionId: 'refund-1',
      idempotencyKey: 'provider-1:refund-1',
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'missing-bet',
    }));

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await reprocessor.reprocessDue(new Date(INITIAL_TIME.getTime() + attempt * 600_000));
    }
    testEm.clear();

    const persistedRefund = await testEm.findOneOrFail(WagerTransactionEntitySchema, refund.transactionId);
    const ledgerEntries = await testEm.count(WalletLedgerEntryEntitySchema, { walletId: WALLET_ID });

    expect(persistedRefund.status).toBe(WagerTransactionStatus.Rejected);
    expect(persistedRefund.failureCode).toBe(WagerFailureCode.ReferenceNotFound);
    expect(persistedRefund.referenceAttempts).toBe(5);
    expect(ledgerEntries).toBe(0);
  }, 15_000);
});

function command(overrides: Partial<Parameters<ProcessWagerTransactionUseCase['execute']>[0]> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000103',
    providerId: 'provider-1',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-1:external-1',
    payloadHash: 'payload-hash-1',
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    occurredAt: INITIAL_TIME,
    ...overrides,
  };
}
