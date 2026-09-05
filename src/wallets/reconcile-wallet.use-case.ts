import { Inject, Injectable, Optional } from '@nestjs/common';

import { Money } from '../domain/money/money';
import { MetricsService } from '../observability/metrics.service';
import { StructuredLogger } from '../observability/structured-logger.service';
import { WALLET_REPOSITORY, type WalletRepository } from './wallet.repository';
import { WalletNotFoundError } from './get-wallet.use-case';

@Injectable()
export class ReconcileWalletUseCase {
  public constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly logger?: StructuredLogger,
  ) {}

  public async execute(walletId: string) {
    const wallet = await this.wallets.reconcile(walletId);
    if (wallet === undefined) throw new WalletNotFoundError(walletId);

    const storedBalance = Money.from({ amount: wallet.balanceAmount, currency: wallet.currency });
    const calculatedBalance = Money.from({ amount: wallet.calculatedBalanceAmount, currency: wallet.currency });

    const result = {
      walletId: wallet.id,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculatedBalance.toJSON(),
      difference: storedBalance.subtract(calculatedBalance).toJSON(),
      consistent: storedBalance.equals(calculatedBalance),
      checkedEntries: wallet.checkedEntries,
    };
    if (!result.consistent) {
      this.metrics?.recordReconciliationDivergence();
      this.logger?.warn('wallet_reconciliation_divergence', { walletId: wallet.id });
    }
    return result;
  }
}
