import { Inject, Injectable } from '@nestjs/common';

import { WALLET_REPOSITORY, type WalletRepository } from './wallet.repository';

export class WalletNotFoundError extends Error {
  public constructor(walletId: string) {
    super(`Wallet ${walletId} was not found.`);
    this.name = 'WalletNotFoundError';
  }
}

@Injectable()
export class GetWalletUseCase {
  public constructor(@Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository) {}

  public async execute(walletId: string) {
    const wallet = await this.wallets.findById(walletId);
    if (wallet === undefined) throw new WalletNotFoundError(walletId);

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: { amount: wallet.balanceAmount, currency: wallet.currency },
      version: wallet.version,
    };
  }
}
