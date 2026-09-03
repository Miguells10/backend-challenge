import { describe, expect, test } from 'bun:test';

import { Money } from '../../../src/domain/money/money';
import {
  InvalidLedgerEntryError,
  WalletLedgerEntry,
} from '../../../src/domain/ledger/wallet-ledger-entry';

const CREATED_AT = new Date('2026-09-03T18:00:00.000Z');

describe('WalletLedgerEntry', () => {
  test('creates an immutable credit entry with the balance evidence', () => {
    const entry = WalletLedgerEntry.create({
      id: 'ledger-1',
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: 'CREDIT',
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('125.00'),
      createdAt: CREATED_AT,
    });

    expect(entry.direction).toBe('CREDIT');
    expect(entry.money.toString()).toBe('25.00 BRL');
    expect(entry.balanceBefore.toString()).toBe('100.00 BRL');
    expect(entry.balanceAfter.toString()).toBe('125.00 BRL');
    expect(entry.createdAt).toBe(CREATED_AT);
  });

  test('creates a debit entry only when the resulting balance matches the movement', () => {
    const entry = WalletLedgerEntry.create({
      id: 'ledger-1',
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: 'DEBIT',
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('75.00'),
      createdAt: CREATED_AT,
    });

    expect(entry.isBalanced()).toBe(true);
  });

  test('rejects an entry whose balance arithmetic does not match its direction', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'ledger-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: 'DEBIT',
        money: money('25.00'),
        balanceBefore: money('100.00'),
        balanceAfter: money('80.00'),
        createdAt: CREATED_AT,
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  test('rejects a zero-value entry', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'ledger-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: 'CREDIT',
        money: money('0.00'),
        balanceBefore: money('100.00'),
        balanceAfter: money('100.00'),
        createdAt: CREATED_AT,
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  test('rejects an entry that mixes currencies', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'ledger-1',
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: 'CREDIT',
        money: money('25.00'),
        balanceBefore: money('100.00'),
        balanceAfter: Money.from({ amount: '125.00', currency: 'USD' }),
        createdAt: CREATED_AT,
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  test('rehydrates an already persisted entry without recalculating it', () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: 'ledger-1',
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: 'DEBIT',
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('75.00'),
      createdAt: CREATED_AT,
    });

    expect(entry.transactionId).toBe('transaction-1');
    expect(entry.isBalanced()).toBe(true);
  });
});

function money(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}
