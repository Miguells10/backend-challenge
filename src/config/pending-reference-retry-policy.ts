export interface PendingReferenceRetryPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  batchSize: number;
  pollIntervalMs: number;
}

export const PENDING_REFERENCE_RETRY_POLICY = Symbol('PENDING_REFERENCE_RETRY_POLICY');

const DEFAULT_POLICY: PendingReferenceRetryPolicy = {
  initialDelayMs: 5_000,
  maxDelayMs: 300_000,
  maxAttempts: 5,
  batchSize: 10,
  pollIntervalMs: 1_000,
};

export function pendingReferenceRetryPolicyFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): PendingReferenceRetryPolicy {
  const policy = {
    initialDelayMs: positiveInteger(environment, 'PENDING_REFERENCE_INITIAL_DELAY_MS', DEFAULT_POLICY.initialDelayMs),
    maxDelayMs: positiveInteger(environment, 'PENDING_REFERENCE_MAX_DELAY_MS', DEFAULT_POLICY.maxDelayMs),
    maxAttempts: positiveInteger(environment, 'PENDING_REFERENCE_MAX_ATTEMPTS', DEFAULT_POLICY.maxAttempts),
    batchSize: positiveInteger(environment, 'PENDING_REFERENCE_BATCH_SIZE', DEFAULT_POLICY.batchSize),
    pollIntervalMs: positiveInteger(environment, 'PENDING_REFERENCE_POLL_INTERVAL_MS', DEFAULT_POLICY.pollIntervalMs),
  };

  if (policy.maxDelayMs < policy.initialDelayMs) {
    throw new Error('PENDING_REFERENCE_MAX_DELAY_MS must be greater than or equal to PENDING_REFERENCE_INITIAL_DELAY_MS.');
  }

  return policy;
}

function positiveInteger(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const value = environment[name];
  if (value === undefined || value === '') {
    return fallback;
  }

  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return Number(value);
}
