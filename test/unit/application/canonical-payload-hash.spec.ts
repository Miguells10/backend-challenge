import { describe, expect, test } from 'bun:test';

import {
  canonicalPayloadHash,
  wagerTransactionPayloadHash,
} from '../../../src/application/idempotency/canonical-payload-hash';

describe('canonicalPayloadHash', () => {
  test('produces the same hash when object keys arrive in another order', () => {
    const first = canonicalPayloadHash({ providerId: 'provider-1', money: { amount: '25.00', currency: 'BRL' } });
    const reordered = canonicalPayloadHash({ money: { currency: 'BRL', amount: '25.00' }, providerId: 'provider-1' });

    expect(first).toBe(reordered);
  });

  test('changes the hash when a business value changes', () => {
    const first = canonicalPayloadHash({ providerId: 'provider-1', money: { amount: '25.00', currency: 'BRL' } });
    const changed = canonicalPayloadHash({ providerId: 'provider-1', money: { amount: '30.00', currency: 'BRL' } });

    expect(first).not.toBe(changed);
  });

  test('excludes idempotency metadata while retaining every wager business field', () => {
    const transaction = {
      providerId: 'provider-1',
      externalTransactionId: 'bet-1',
      playerId: 'player-1',
      walletId: 'wallet-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };

    const first = wagerTransactionPayloadHash({ ...transaction, idempotencyKey: 'provider-1:bet-1' });
    const replayFromAnotherTransport = wagerTransactionPayloadHash({ ...transaction, idempotencyKey: 'other-transport-value' });
    const changedBusinessValue = wagerTransactionPayloadHash({ ...transaction, roundId: 'round-2' });

    expect(first).toBe(replayFromAnotherTransport);
    expect(first).not.toBe(changedBusinessValue);
  });
});
