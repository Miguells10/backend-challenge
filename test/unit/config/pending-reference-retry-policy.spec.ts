import { describe, expect, test } from 'bun:test';

import { pendingReferenceRetryPolicyFromEnvironment } from '../../../src/config/pending-reference-retry-policy';

describe('pendingReferenceRetryPolicyFromEnvironment', () => {
  test('uses stable defaults when retry variables are absent', () => {
    expect(pendingReferenceRetryPolicyFromEnvironment({})).toEqual({
      initialDelayMs: 5_000,
      maxDelayMs: 300_000,
      maxAttempts: 5,
      batchSize: 10,
      pollIntervalMs: 1_000,
    });
  });

  test('accepts an explicit operational policy', () => {
    expect(pendingReferenceRetryPolicyFromEnvironment({
      PENDING_REFERENCE_INITIAL_DELAY_MS: '1000',
      PENDING_REFERENCE_MAX_DELAY_MS: '60000',
      PENDING_REFERENCE_MAX_ATTEMPTS: '3',
      PENDING_REFERENCE_BATCH_SIZE: '25',
      PENDING_REFERENCE_POLL_INTERVAL_MS: '250',
    })).toEqual({
      initialDelayMs: 1_000,
      maxDelayMs: 60_000,
      maxAttempts: 3,
      batchSize: 25,
      pollIntervalMs: 250,
    });
  });

  test('rejects an invalid policy during startup', () => {
    expect(() => pendingReferenceRetryPolicyFromEnvironment({
      PENDING_REFERENCE_INITIAL_DELAY_MS: '60000',
      PENDING_REFERENCE_MAX_DELAY_MS: '5000',
    })).toThrow('PENDING_REFERENCE_MAX_DELAY_MS must be greater than or equal to PENDING_REFERENCE_INITIAL_DELAY_MS.');
  });
});
