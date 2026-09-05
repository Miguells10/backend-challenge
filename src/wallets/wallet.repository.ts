export interface WalletSnapshot {
  id: string;
  playerId: string;
  balanceAmount: string;
  currency: string;
  version: number;
}

export interface WalletRepository {
  findById(walletId: string): Promise<WalletSnapshot | undefined>;
  findMany(limit: number): Promise<WalletSnapshot[]>;
}

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');
