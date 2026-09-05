import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { type WalletRepository, type WalletSnapshot } from '../../../wallets/wallet.repository';
import { WalletEntitySchema } from '../entities/wallet.entity';

@Injectable()
export class MikroOrmWalletRepository implements WalletRepository {
  public constructor(private readonly orm: MikroORM) {}

  public async findById(walletId: string): Promise<WalletSnapshot | undefined> {
    const wallet = await this.orm.em.fork().findOne(WalletEntitySchema, { id: walletId });
    if (wallet === null) return undefined;

    return this.toSnapshot(wallet);
  }

  public async findMany(limit: number): Promise<WalletSnapshot[]> {
    const wallets = await this.orm.em.fork().find(
      WalletEntitySchema,
      {},
      { limit, orderBy: { createdAt: 'desc', id: 'desc' } },
    );

    return wallets.map((wallet) => this.toSnapshot(wallet));
  }

  private toSnapshot(wallet: { id: string; playerId: string; balanceAmount: string; currency: string; version: number }): WalletSnapshot {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balanceAmount: wallet.balanceAmount,
      currency: wallet.currency,
      version: wallet.version,
    };
  }
}
