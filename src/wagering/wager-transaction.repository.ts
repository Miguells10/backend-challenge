import { WagerTransactionKind, WagerTransactionStatus } from '../domain/wagering/wager-transaction';

export interface WagerTransactionSnapshot {
  id: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
  failureCode?: string;
  amount: string;
  currency: string;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  resultBalanceAmount?: string;
  createdAt: Date;
  processedAt?: Date;
}

export interface WagerTransactionRepository {
  findById(transactionId: string): Promise<WagerTransactionSnapshot | undefined>;
  findByExternalId(providerId: string, externalTransactionId: string): Promise<WagerTransactionSnapshot | undefined>;
}

export const WAGER_TRANSACTION_REPOSITORY = Symbol('WAGER_TRANSACTION_REPOSITORY');
