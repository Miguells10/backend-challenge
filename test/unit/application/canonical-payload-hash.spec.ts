import { describe, expect, test } from 'bun:test';

import { canonicalPayloadHash } from '../../../src/application/idempotency/canonical-payload-hash';

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
});
