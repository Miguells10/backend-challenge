import { Inject, Injectable } from '@nestjs/common';

import { WALLET_REPOSITORY, type WalletRepository } from './wallet.repository';

@Injectable()
export class ListWalletsUseCase {
  public constructor(@Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository) {}

  public async execute(limit: number) {
    const wallets = await this.wallets.findMany(limit);

    return {
      items: wallets.map((wallet) => ({
        id: wallet.id,
        playerId: wallet.playerId,
        balance: { amount: wallet.balanceAmount, currency: wallet.currency },
        version: wallet.version,
      })),
      limit,
    };
  }
}
