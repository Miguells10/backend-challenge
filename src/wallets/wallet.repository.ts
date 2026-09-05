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

export interface WalletLedgerEntrySnapshot {
  id: string;
  transactionId: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: Date;
}

export interface WalletLedgerCursor {
  createdAt: Date;
  id: string;
}

export interface WalletLedgerPage {
  entries: WalletLedgerEntrySnapshot[];
  hasMore: boolean;
}

export interface WalletRepository {
  findById(walletId: string): Promise<WalletSnapshot | undefined>;
  findMany(limit: number): Promise<WalletSnapshot[]>;
  reconcile(walletId: string): Promise<WalletReconciliationSnapshot | undefined>;
  findLedgerPage(walletId: string, cursor: WalletLedgerCursor | undefined, limit: number): Promise<WalletLedgerPage>;
}

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');
