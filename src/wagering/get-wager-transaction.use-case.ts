import { Inject, Injectable } from '@nestjs/common';

import {
  WAGER_TRANSACTION_REPOSITORY,
  type WagerTransactionRepository,
} from './wager-transaction.repository';

export class WagerTransactionNotFoundError extends Error {
  public constructor() {
    super('Wager transaction was not found.');
    this.name = 'WagerTransactionNotFoundError';
  }
}

@Injectable()
export class GetWagerTransactionUseCase {
  public constructor(
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: WagerTransactionRepository,
  ) {}

  public async byId(transactionId: string) {
    return this.toResponse(await this.transactions.findById(transactionId));
  }

  public async byExternalId(providerId: string, externalTransactionId: string) {
    return this.toResponse(await this.transactions.findByExternalId(providerId, externalTransactionId));
  }

  private toResponse(transaction: Awaited<ReturnType<WagerTransactionRepository['findById']>>) {
    if (transaction === undefined) throw new WagerTransactionNotFoundError();

    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      status: transaction.status,
      failureCode: transaction.failureCode,
      money: { amount: transaction.amount, currency: transaction.currency },
      referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      referenceTransactionId: transaction.referenceTransactionId,
      balance: transaction.resultBalanceAmount === undefined
        ? undefined
        : { amount: transaction.resultBalanceAmount, currency: transaction.currency },
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt,
    };
  }
}
