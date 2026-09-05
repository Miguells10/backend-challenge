import { createHash } from 'node:crypto';

export interface WagerTransactionBusinessPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: {
    amount: string;
    currency: string;
  };
  referenceExternalTransactionId?: string;
}

export function canonicalPayloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

/**
 * Hashes only the business fields of a wager transaction. Transport metadata,
 * including the idempotency key, must never affect idempotency semantics.
 */
export function wagerTransactionPayloadHash<T extends WagerTransactionBusinessPayload>(payload: T): string {
  const businessPayload: WagerTransactionBusinessPayload = {
    providerId: payload.providerId,
    externalTransactionId: payload.externalTransactionId,
    playerId: payload.playerId,
    walletId: payload.walletId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: payload.money,
  };
  if (payload.referenceExternalTransactionId !== undefined) {
    businessPayload.referenceExternalTransactionId = payload.referenceExternalTransactionId;
  }

  return canonicalPayloadHash(businessPayload);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  if (typeof value !== 'object') {
    throw new TypeError('Payload must contain JSON-compatible values.');
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(',')}}`;
}
