import { EntitySchema } from '@mikro-orm/core';

import {
  type WagerFailureCode,
  type WagerTransactionKind,
  type WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction';

export interface WagerTransactionEntity {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  status: WagerTransactionStatus;
  failureCode?: WagerFailureCode;
  resultBalanceAmount?: string;
  referenceAttempts: number;
  nextReferenceAttemptAt?: Date;
  createdAt: Date;
  processedAt?: Date;
}

export const WagerTransactionEntitySchema = new EntitySchema<WagerTransactionEntity>({
  name: 'WagerTransactionEntity',
  tableName: 'wager_transactions',
  properties: {
    id: { type: 'uuid', primary: true },
    providerId: { type: 'string', fieldName: 'provider_id', length: 128 },
    externalTransactionId: { type: 'string', fieldName: 'external_transaction_id', length: 255 },
    idempotencyKey: { type: 'string', fieldName: 'idempotency_key', length: 512 },
    payloadHash: { type: 'string', fieldName: 'payload_hash', length: 128 },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    playerId: { type: 'uuid', fieldName: 'player_id' },
    roundId: { type: 'string', fieldName: 'round_id', length: 255 },
    gameId: { type: 'string', fieldName: 'game_id', length: 255 },
    kind: { type: 'string' },
    amount: { type: 'decimal', columnType: 'numeric(18,2)' },
    currency: { type: 'string', columnType: 'char(3)' },
    referenceExternalTransactionId: {
      type: 'string',
      fieldName: 'reference_external_transaction_id',
      length: 255,
      nullable: true,
    },
    referenceTransactionId: { type: 'uuid', fieldName: 'reference_transaction_id', nullable: true },
    status: { type: 'string' },
    failureCode: { type: 'string', fieldName: 'failure_code', length: 64, nullable: true },
    resultBalanceAmount: {
      type: 'decimal',
      columnType: 'numeric(18,2)',
      fieldName: 'result_balance_amount',
      nullable: true,
    },
    referenceAttempts: { type: 'integer', fieldName: 'reference_attempts', default: 0 },
    nextReferenceAttemptAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      fieldName: 'next_reference_attempt_at',
      nullable: true,
    },
    createdAt: { type: 'datetime', columnType: 'timestamptz', fieldName: 'created_at' },
    processedAt: { type: 'datetime', columnType: 'timestamptz', fieldName: 'processed_at', nullable: true },
  },
  indexes: [
    { name: 'wager_transactions_wallet_created_at_index', properties: ['walletId', 'createdAt'] },
    {
      name: 'wager_transactions_provider_reference_external_id_index',
      properties: ['providerId', 'referenceExternalTransactionId'],
    },
    {
      name: 'wager_transactions_pending_reference_cursor_index',
      properties: ['status', 'nextReferenceAttemptAt'],
    },
  ],
  uniques: [
    { name: 'wager_transactions_idempotency_key_unique', properties: ['idempotencyKey'] },
    {
      name: 'wager_transactions_provider_external_id_unique',
      properties: ['providerId', 'externalTransactionId'],
    },
  ],
});
