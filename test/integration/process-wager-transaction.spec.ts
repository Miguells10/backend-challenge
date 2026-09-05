import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { Money } from '../../src/domain/money/money';
import {
  WagerFailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/wagering/wager-transaction';
import {
  IdempotencyConflictError,
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionCommand,
} from '../../src/application/wagering/process-wager-transaction.use-case';
import { pendingReferenceRetryPolicyFromEnvironment } from '../../src/config/pending-reference-retry-policy';
import { CreateWalletUseCase } from '../../src/wallets/create-wallet.use-case';
import { WalletLedgerEntryEntitySchema } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { MikroOrmWalletRepository } from '../../src/infrastructure/persistence/repositories/mikro-orm-wallet.repository';
import { WalletEntitySchema } from '../../src/infrastructure/persistence/entities/wallet.entity';
import { OutboxMessageEntitySchema } from '../../src/infrastructure/persistence/entities/outbox-message.entity';
import { WagerTransactionEntitySchema } from '../../src/infrastructure/persistence/entities/wager-transaction.entity';
import mikroOrmConfig from '../../mikro-orm.config';

const describeIntegration = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
const WALLET_ID = '00000000-0000-0000-0000-000000000101';
const PLAYER_ID = '00000000-0000-0000-0000-000000000102';

describeIntegration('ProcessWagerTransactionUseCase', () => {
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
    testEm.persist(
      testEm.create(WalletEntitySchema, {
        id: WALLET_ID,
        playerId: PLAYER_ID,
        currency: 'BRL',
        balanceAmount: '100.00',
        version: 1,
        createdAt: new Date('2026-09-04T18:00:00.000Z'),
        updatedAt: new Date('2026-09-04T18:00:00.000Z'),
      }),
    );
    await testEm.flush();
  });

  afterAll(async () => {
    await orm.close(true);
  });

  test('atomically processes a bet, updates the wallet, and records its ledger entry', async () => {
    const result = await useCase.execute(command());
    testEm.clear();

    const wallet = await testEm.findOneOrFail(WalletEntitySchema, WALLET_ID);
    const ledgerEntries = await testEm.find(WalletLedgerEntryEntitySchema, { walletId: WALLET_ID });
    const outboxMessages = await testEm.find(OutboxMessageEntitySchema, {});

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance.toString()).toBe('75.00 BRL');
    expect(wallet.balanceAmount).toBe('75.00');
    expect(wallet.version).toBe(2);
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]?.direction).toBe('DEBIT');
    expect(outboxMessages.map((message) => message.eventType).sort()).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
  });

  test('persists a rejection without changing the wallet or creating ledger', async () => {
    const result = await useCase.execute(command({ money: money('100.01') }));
    testEm.clear();

    const wallet = await testEm.findOneOrFail(WalletEntitySchema, WALLET_ID);
    const ledgerEntries = await testEm.count(WalletLedgerEntryEntitySchema, { walletId: WALLET_ID });
    const outboxMessages = await testEm.find(OutboxMessageEntitySchema, { aggregateId: result.transactionId });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(WagerFailureCode.InsufficientFunds);
    expect(wallet.balanceAmount).toBe('100.00');
    expect(ledgerEntries).toBe(0);
    expect(outboxMessages.map((message) => message.eventType)).toEqual(['WagerTransactionRejected']);
  });

  test('replays an identical idempotency key without creating a second debit', async () => {
    const first = await useCase.execute(command());
    const replay = await useCase.execute(command());
    testEm.clear();

    const transactions = await testEm.count(WagerTransactionEntitySchema, { idempotencyKey: 'provider-1:external-1' });
    const ledgerEntries = await testEm.count(WalletLedgerEntryEntitySchema, { walletId: WALLET_ID });

    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.balance.toString()).toBe('75.00 BRL');
    expect(transactions).toBe(1);
    expect(ledgerEntries).toBe(1);
  });

  test('processes fifty concurrent copies of the same wager only once', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => useCase.execute(command())),
    );
    testEm.clear();

    const wallet = await testEm.findOneOrFail(WalletEntitySchema, WALLET_ID);
    const transactions = await testEm.count(WagerTransactionEntitySchema, { idempotencyKey: 'provider-1:external-1' });
    const ledgerEntries = await testEm.count(WalletLedgerEntryEntitySchema, { walletId: WALLET_ID });

    expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
    expect(results.filter((result) => result.idempotentReplay)).toHaveLength(49);
    expect(wallet.balanceAmount).toBe('75.00');
    expect(wallet.version).toBe(2);
    expect(transactions).toBe(1);
    expect(ledgerEntries).toBe(1);
  });

  test('processes exactly one of two concurrent bets of 80.00 and keeps the ledger reconciled', async () => {
    await testEm.getConnection().execute('truncate table outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
    const playerId = crypto.randomUUID();
    const openedWallet = await new CreateWalletUseCase(orm).execute({
      playerId,
      initialBalance: money('100.00'),
    });
    const results = await Promise.all([
      useCase.execute(command({
        id: '00000000-0000-0000-0000-000000000201',
        externalTransactionId: 'competing-bet-1',
        idempotencyKey: 'provider-1:competing-bet-1',
        payloadHash: 'payload-hash-competing-1',
        walletId: openedWallet.id,
        playerId,
        money: money('80.00'),
      })),
      useCase.execute(command({
        id: '00000000-0000-0000-0000-000000000202',
        externalTransactionId: 'competing-bet-2',
        idempotencyKey: 'provider-1:competing-bet-2',
        payloadHash: 'payload-hash-competing-2',
        walletId: openedWallet.id,
        playerId,
        money: money('80.00'),
      })),
    ]);
    testEm.clear();

    const wallet = await testEm.findOneOrFail(WalletEntitySchema, openedWallet.id);
    const ledgerEntries = await testEm.find(WalletLedgerEntryEntitySchema, { walletId: openedWallet.id });
    const reconciliation = await new MikroOrmWalletRepository(orm).reconcile(openedWallet.id);

    expect(results.filter((result) => result.status === WagerTransactionStatus.Processed)).toHaveLength(1);
    expect(results.filter((result) => result.status === WagerTransactionStatus.Rejected)).toHaveLength(1);
    expect(wallet.balanceAmount).toBe('20.00');
    expect(wallet.version).toBe(2);
    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries.filter((entry) => entry.direction === 'DEBIT')).toHaveLength(1);
    expect(reconciliation?.calculatedBalanceAmount).toBe('20.00');
  });

  test('processes independent wallets concurrently without cross-wallet blocking', async () => {
    const secondWalletId = '00000000-0000-0000-0000-000000000301';
    const secondPlayerId = '00000000-0000-0000-0000-000000000302';
    testEm.persist(testEm.create(WalletEntitySchema, {
      id: secondWalletId,
      playerId: secondPlayerId,
      currency: 'BRL',
      balanceAmount: '100.00',
      version: 1,
      createdAt: new Date('2026-09-04T18:00:00.000Z'),
      updatedAt: new Date('2026-09-04T18:00:00.000Z'),
    }));
    await testEm.flush();

    const results = await Promise.all([
      useCase.execute(command()),
      useCase.execute(command({
        id: '00000000-0000-0000-0000-000000000303',
        externalTransactionId: 'independent-wallet-bet',
        idempotencyKey: 'provider-1:independent-wallet-bet',
        payloadHash: 'payload-hash-independent-wallet',
        walletId: secondWalletId,
        playerId: secondPlayerId,
      })),
    ]);
    testEm.clear();

    const wallets = await testEm.find(WalletEntitySchema, { id: { $in: [WALLET_ID, secondWalletId] } });
    const ledgerEntries = await testEm.count(WalletLedgerEntryEntitySchema, { walletId: { $in: [WALLET_ID, secondWalletId] } });

    expect(results.every((result) => result.status === WagerTransactionStatus.Processed)).toBe(true);
    expect(wallets.map((wallet) => wallet.balanceAmount).sort()).toEqual(['75.00', '75.00']);
    expect(wallets.map((wallet) => wallet.version).sort()).toEqual([2, 2]);
    expect(ledgerEntries).toBe(2);
  });

  test('rejects reuse of an idempotency key with another payload', async () => {
    await useCase.execute(command());

    await expect(useCase.execute(command({ payloadHash: 'another-payload-hash' }))).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });

  test('persists a reversal with a missing reference as pending without moving balance', async () => {
    const result = await useCase.execute(
      command({
        kind: WagerTransactionKind.Refund,
        externalTransactionId: 'refund-1',
        idempotencyKey: 'provider-1:refund-1',
        referenceExternalTransactionId: 'bet-not-yet-arrived',
      }),
    );
    testEm.clear();

    const wallet = await testEm.findOneOrFail(WalletEntitySchema, WALLET_ID);
    const ledgerEntries = await testEm.count(WalletLedgerEntryEntitySchema, { walletId: WALLET_ID });
    const outboxMessages = await testEm.find(OutboxMessageEntitySchema, { aggregateId: result.transactionId });

    expect(result.status).toBe(WagerTransactionStatus.PendingReference);
    expect(wallet.balanceAmount).toBe('100.00');
    expect(ledgerEntries).toBe(0);
    expect(outboxMessages.map((message) => message.eventType)).toEqual(['WagerTransactionPendingReference']);
  });

  test('processes only one refund for the same bet, even when requests race', async () => {
    const bet = await useCase.execute(command({
      id: '00000000-0000-0000-0000-000000000601',
      externalTransactionId: 'bet-to-refund',
      idempotencyKey: 'provider-1:bet-to-refund',
      payloadHash: 'payload-hash-bet-to-refund',
    }));

    expect(bet.status).toBe(WagerTransactionStatus.Processed);

    const results = await Promise.all([
      useCase.execute(command({
        id: '00000000-0000-0000-0000-000000000602',
        kind: WagerTransactionKind.Refund,
        externalTransactionId: 'refund-first',
        idempotencyKey: 'provider-1:refund-first',
        payloadHash: 'payload-hash-refund-first',
        referenceExternalTransactionId: 'bet-to-refund',
      })),
      useCase.execute(command({
        id: '00000000-0000-0000-0000-000000000603',
        kind: WagerTransactionKind.Refund,
        externalTransactionId: 'refund-second',
        idempotencyKey: 'provider-1:refund-second',
        payloadHash: 'payload-hash-refund-second',
        referenceExternalTransactionId: 'bet-to-refund',
      })),
    ]);
    testEm.clear();

    const wallet = await testEm.findOneOrFail(WalletEntitySchema, WALLET_ID);
    const ledgerEntries = await testEm.find(WalletLedgerEntryEntitySchema, { walletId: WALLET_ID });

    expect(results.filter((result) => result.status === WagerTransactionStatus.Processed)).toHaveLength(1);
    expect(results.filter((result) => result.status === WagerTransactionStatus.Rejected)).toHaveLength(1);
    expect(results.find((result) => result.status === WagerTransactionStatus.Rejected)?.failureCode)
      .toBe(WagerFailureCode.ReversalAlreadyProcessed);
    expect(wallet.balanceAmount).toBe('100.00');
    expect(ledgerEntries).toHaveLength(2);
  });
});

function command(overrides: Partial<ProcessWagerTransactionCommand> = {}): ProcessWagerTransactionCommand {
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
    money: money('25.00'),
    occurredAt: new Date('2026-09-04T18:00:00.000Z'),
    ...overrides,
  };
}

function money(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}
