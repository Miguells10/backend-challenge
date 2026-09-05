export interface WalletSnapshot {
  id: string;
  playerId: string;
  balanceAmount: string;
  currency: string;
  version: number;
}

export interface WalletReconciliationSnapshot extends WalletSnapshot {
  calculatedBalanceAmount: string;
  checkedEntries: number;
}

export interface WalletRepository {
  findById(walletId: string): Promise<WalletSnapshot | undefined>;
  findMany(limit: number): Promise<WalletSnapshot[]>;
  reconcile(walletId: string): Promise<WalletReconciliationSnapshot | undefined>;
}

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');
