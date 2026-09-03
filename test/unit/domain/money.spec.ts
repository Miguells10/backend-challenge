import { describe, expect, test } from 'bun:test';

import { Money } from '../../../src/domain/money/money';

describe('Money', () => {
  test('serializes a valid amount with its currency', () => {
    const money = Money.from({ amount: '25.00', currency: 'BRL' });

    expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
  });

  test('adds decimal amounts exactly without using floating point arithmetic', () => {
    const result = Money.from({ amount: '0.10', currency: 'BRL' }).add(
      Money.from({ amount: '0.20', currency: 'BRL' }),
    );

    expect(result.toString()).toBe('0.30 BRL');
  });

  test('returns new values instead of mutating either operand', () => {
    const original = Money.from({ amount: '25.00', currency: 'BRL' });
    const result = original.add(Money.from({ amount: '10.00', currency: 'BRL' }));

    expect(original.toString()).toBe('25.00 BRL');
    expect(result.toString()).toBe('35.00 BRL');
  });

  test('rejects external amounts that do not have exactly two decimal places', () => {
    expect(() => Money.from({ amount: '25', currency: 'BRL' })).toThrow();
    expect(() => Money.from({ amount: '25.0', currency: 'BRL' })).toThrow();
    expect(() => Money.from({ amount: '25.000', currency: 'BRL' })).toThrow();
  });

  test('rejects negative, scientific, and non-finite external amounts', () => {
    expect(() => Money.from({ amount: '-1.00', currency: 'BRL' })).toThrow();
    expect(() => Money.from({ amount: '1e2', currency: 'BRL' })).toThrow();
    expect(() => Money.from({ amount: 'Infinity', currency: 'BRL' })).toThrow();
  });

  test('rejects arithmetic between different currencies', () => {
    const brl = Money.from({ amount: '25.00', currency: 'BRL' });
    const usd = Money.from({ amount: '25.00', currency: 'USD' });

    expect(() => brl.add(usd)).toThrow();
  });

  test('creates a zero value and can negate an internal result', () => {
    const zero = Money.zero('BRL');
    const negative = Money.from({ amount: '25.00', currency: 'BRL' }).negate();

    expect(zero.isZero()).toBe(true);
    expect(negative.toString()).toBe('-25.00 BRL');
  });
});
