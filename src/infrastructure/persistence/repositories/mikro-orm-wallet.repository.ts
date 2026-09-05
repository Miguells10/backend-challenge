import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import {
  type WalletReconciliationSnapshot,
  type WalletRepository,
  type WalletSnapshot,
} from '../../../wallets/wallet.repository';
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

  public async reconcile(walletId: string): Promise<WalletReconciliationSnapshot | undefined> {
    const rows = await this.orm.em.fork().getConnection().execute<WalletReconciliationRow[]>(
      `
        select
          w."id",
          w."player_id" as "playerId",
          w."balance_amount" as "balanceAmount",
          w."currency",
          w."version",
          coalesce(sum(case when le."direction" = 'CREDIT' then le."amount" else -le."amount" end), 0)::numeric(18,2)::text as "calculatedBalanceAmount",
          count(le."id")::integer as "checkedEntries"
        from "wallets" w
        left join "wallet_ledger_entries" le on le."wallet_id" = w."id"
        where w."id" = ?
        group by w."id", w."player_id", w."balance_amount", w."currency", w."version"
      `,
      [walletId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;

    return {
      id: row.id,
      playerId: row.playerId,
      balanceAmount: row.balanceAmount,
      currency: row.currency,
      version: row.version,
      calculatedBalanceAmount: row.calculatedBalanceAmount,
      checkedEntries: Number(row.checkedEntries),
    };
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

interface WalletReconciliationRow {
  id: string;
  playerId: string;
  balanceAmount: string;
  currency: string;
  version: number;
  calculatedBalanceAmount: string;
  checkedEntries: number | string;
}
