import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import {
  type WagerTransactionRepository,
  type WagerTransactionSnapshot,
} from '../../../wagering/wager-transaction.repository';
import {
  WagerTransactionEntitySchema,
  type WagerTransactionEntity,
} from '../entities/wager-transaction.entity';

@Injectable()
export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  public constructor(private readonly orm: MikroORM) {}

  public async findById(transactionId: string): Promise<WagerTransactionSnapshot | undefined> {
    const transaction = await this.orm.em.fork().findOne(WagerTransactionEntitySchema, { id: transactionId });
    return transaction === null ? undefined : this.toSnapshot(transaction);
  }

  public async findByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionSnapshot | undefined> {
    const transaction = await this.orm.em.fork().findOne(WagerTransactionEntitySchema, {
      providerId,
      externalTransactionId,
    });
    return transaction === null ? undefined : this.toSnapshot(transaction);
  }

  private toSnapshot(transaction: WagerTransactionEntity): WagerTransactionSnapshot {
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
      amount: transaction.amount,
      currency: transaction.currency,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      referenceTransactionId: transaction.referenceTransactionId,
      resultBalanceAmount: transaction.resultBalanceAmount,
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt,
    };
  }
}
