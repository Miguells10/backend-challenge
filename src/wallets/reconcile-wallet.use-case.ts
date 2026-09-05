import { Inject, Injectable } from '@nestjs/common';

import { Money } from '../domain/money/money';
import { WALLET_REPOSITORY, type WalletRepository } from './wallet.repository';
import { WalletNotFoundError } from './get-wallet.use-case';

@Injectable()
export class ReconcileWalletUseCase {
  public constructor(@Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository) {}

  public async execute(walletId: string) {
    const wallet = await this.wallets.reconcile(walletId);
    if (wallet === undefined) throw new WalletNotFoundError(walletId);

    const storedBalance = Money.from({ amount: wallet.balanceAmount, currency: wallet.currency });
    const calculatedBalance = Money.from({ amount: wallet.calculatedBalanceAmount, currency: wallet.currency });

    return {
      walletId: wallet.id,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculatedBalance.toJSON(),
      difference: storedBalance.subtract(calculatedBalance).toJSON(),
      consistent: storedBalance.equals(calculatedBalance),
      checkedEntries: wallet.checkedEntries,
    };
  }
}
