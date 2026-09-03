import { describe, expect, test } from 'bun:test';

import { Money } from '../../../src/domain/money/money';
import {
  InvalidTransactionReferenceError,
  InvalidTransactionStateError,
  InvalidWagerTransactionError,
  WagerFailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction';

const CREATED_AT = new Date('2026-09-03T18:00:00.000Z');
const PROCESSED_AT = new Date('2026-09-03T18:01:00.000Z');

describe('WagerTransaction', () => {
  test('starts a new transaction as pending', () => {
    const transaction = createTransaction();

    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    expect(transaction.isTerminal()).toBe(false);
  });

  test('requires a reference for refund and rollback', () => {
    expect(() => createTransaction({ kind: WagerTransactionKind.Refund })).toThrow(InvalidWagerTransactionError);
    expect(() => createTransaction({ kind: WagerTransactionKind.Rollback })).toThrow(InvalidWagerTransactionError);
  });

  test('marks an unresolved reversal as pending reference and later processes it', () => {
    const transaction = createTransaction({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'bet-1',
    });

    transaction.markPendingReference();
    transaction.markProcessed('transaction-bet-1', PROCESSED_AT);

    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.referenceTransactionId).toBe('transaction-bet-1');
    expect(transaction.processedAt).toBe(PROCESSED_AT);
  });

  test('does not allow a terminal transaction to transition again', () => {
    const transaction = createTransaction();
    transaction.reject(WagerFailureCode.InsufficientFunds);

    expect(() => transaction.markProcessed(undefined, PROCESSED_AT)).toThrow(InvalidTransactionStateError);
  });

  test('exposes whether each kind changes the balance and its ledger direction', () => {
    const bet = createTransaction({ kind: WagerTransactionKind.Bet });
    const win = createTransaction({ kind: WagerTransactionKind.Win });
    const loss = createTransaction({ kind: WagerTransactionKind.Loss });

    expect(bet.affectsBalance()).toBe(true);
    expect(bet.ledgerDirectionFor()).toBe('DEBIT');
    expect(win.ledgerDirectionFor()).toBe('CREDIT');
    expect(loss.affectsBalance()).toBe(false);
  });

  test('uses the inverse ledger direction when rolling back a referenced transaction', () => {
    const bet = createTransaction({ kind: WagerTransactionKind.Bet });
    const rollback = createTransaction({
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: bet.externalTransactionId,
    });

    expect(rollback.ledgerDirectionFor(bet)).toBe('CREDIT');
  });

  test('validates that a refund references a processed bet from the same round and amount', () => {
    const bet = createTransaction({ kind: WagerTransactionKind.Bet });
    bet.markProcessed(undefined, PROCESSED_AT);
    const refund = createTransaction({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: bet.externalTransactionId,
    });

    expect(() => refund.assertCanReference(bet)).not.toThrow();
  });

  test('allows a win to optionally reference the processed bet that originated the round', () => {
    const bet = createTransaction({ kind: WagerTransactionKind.Bet });
    bet.markProcessed(undefined, PROCESSED_AT);
    const win = createTransaction({
      kind: WagerTransactionKind.Win,
      referenceExternalTransactionId: bet.externalTransactionId,
    });

    expect(() => win.assertCanReference(bet)).not.toThrow();
  });

  test('rejects a reference with a different amount', () => {
    const bet = createTransaction({ kind: WagerTransactionKind.Bet });
    bet.markProcessed(undefined, PROCESSED_AT);
    const refund = createTransaction({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: bet.externalTransactionId,
      money: money('20.00'),
    });

    expect(() => refund.assertCanReference(bet)).toThrow(InvalidTransactionReferenceError);
  });

  test('recognizes a replay only when the stored payload hash matches', () => {
    const transaction = createTransaction({ payloadHash: 'hash-1' });

    expect(transaction.matchesPayload('hash-1')).toBe(true);
    expect(transaction.matchesPayload('hash-2')).toBe(false);
  });

  test('rejects zero-value transactions', () => {
    expect(() => createTransaction({ money: Money.zero('BRL') })).toThrow(InvalidWagerTransactionError);
  });
});

function createTransaction(overrides: Partial<CreateTransactionInput> = {}): WagerTransaction {
  return WagerTransaction.create({
    id: 'transaction-1',
    providerId: 'provider-1',
    externalTransactionId: 'external-transaction-1',
    idempotencyKey: 'provider-1:external-transaction-1',
    payloadHash: 'payload-hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: money('25.00'),
    createdAt: CREATED_AT,
    ...overrides,
  });
}

function money(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

type CreateTransactionInput = Parameters<typeof WagerTransaction.create>[0];
