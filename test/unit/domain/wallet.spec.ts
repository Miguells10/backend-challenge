import { describe, expect, test } from 'bun:test';

import { Money } from '../../../src/domain/money/money';
import { InsufficientFundsError, Wallet } from '../../../src/domain/wallet/wallet';

const INITIAL_BALANCE = Money.from({ amount: '100.00', currency: 'BRL' });
const CHANGE_AT = new Date('2026-09-03T18:00:00.000Z');

describe('Wallet', () => {
  test('opens with version one and the supplied initial balance', () => {
    const wallet = Wallet.open({ id: 'wallet-1', playerId: 'player-1', initialBalance: INITIAL_BALANCE });

    expect(wallet.version).toBe(1);
    expect(wallet.balance.toString()).toBe('100.00 BRL');
  });

  test('credits the balance and returns the recorded change', () => {
    const wallet = openWallet();
    const change = wallet.credit(Money.from({ amount: '25.00', currency: 'BRL' }), CHANGE_AT);

    expect(change.direction).toBe('CREDIT');
    expect(change.balanceBefore.toString()).toBe('100.00 BRL');
    expect(change.balanceAfter.toString()).toBe('125.00 BRL');
    expect(change.walletVersion).toBe(2);
  });

  test('debits the balance and increments the version', () => {
    const wallet = openWallet();
    const change = wallet.debit(Money.from({ amount: '25.00', currency: 'BRL' }), CHANGE_AT);

    expect(change.direction).toBe('DEBIT');
    expect(wallet.balance.toString()).toBe('75.00 BRL');
    expect(wallet.version).toBe(2);
  });

  test('rejects a debit that would make the balance negative without changing state', () => {
    const wallet = openWallet();

    expect(() => wallet.debit(Money.from({ amount: '100.01', currency: 'BRL' }), CHANGE_AT)).toThrow(
      InsufficientFundsError,
    );
    expect(wallet.balance.toString()).toBe('100.00 BRL');
    expect(wallet.version).toBe(1);
  });

  test('rejects a movement in another currency without changing state', () => {
    const wallet = openWallet();

    expect(() => wallet.credit(Money.from({ amount: '1.00', currency: 'USD' }), CHANGE_AT)).toThrow();
    expect(wallet.balance.toString()).toBe('100.00 BRL');
    expect(wallet.version).toBe(1);
  });

  test('rejects a zero-value movement because it would not produce a ledger entry', () => {
    const wallet = openWallet();

    expect(() => wallet.credit(Money.zero('BRL'), CHANGE_AT)).toThrow();
    expect(wallet.version).toBe(1);
  });

  test('rehydrates persisted state without applying a new transition', () => {
    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: Money.from({ amount: '75.00', currency: 'BRL' }),
      version: 4,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: CHANGE_AT,
    });

    expect(wallet.balance.toString()).toBe('75.00 BRL');
    expect(wallet.version).toBe(4);
    expect(wallet.updatedAt).toBe(CHANGE_AT);
  });
});

function openWallet(): Wallet {
  return Wallet.open({ id: 'wallet-1', playerId: 'player-1', initialBalance: INITIAL_BALANCE });
}
