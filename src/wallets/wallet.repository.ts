export interface WalletSnapshot {
  id: string;
  playerId: string;
  balanceAmount: string;
  currency: string;
  version: number;
}

export interface WalletRepository {
  findById(walletId: string): Promise<WalletSnapshot | undefined>;
}

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');
