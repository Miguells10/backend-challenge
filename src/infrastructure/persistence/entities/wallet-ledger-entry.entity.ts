import { EntitySchema } from '@mikro-orm/core';

import { type LedgerDirection } from '../../../domain/wallet/wallet';

export interface WalletLedgerEntryEntity {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: Date;
}

export const WalletLedgerEntryEntitySchema = new EntitySchema<WalletLedgerEntryEntity>({
  name: 'WalletLedgerEntryEntity',
  tableName: 'wallet_ledger_entries',
  properties: {
    id: { type: 'uuid', primary: true },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    transactionId: { type: 'uuid', fieldName: 'transaction_id' },
    direction: { type: 'string', columnType: 'varchar(6)' },
    amount: { type: 'decimal', columnType: 'numeric(18,2)' },
    currency: { type: 'string', columnType: 'char(3)' },
    balanceBefore: { type: 'decimal', columnType: 'numeric(18,2)', fieldName: 'balance_before' },
    balanceAfter: { type: 'decimal', columnType: 'numeric(18,2)', fieldName: 'balance_after' },
    createdAt: { type: 'datetime', columnType: 'timestamptz', fieldName: 'created_at' },
  },
  indexes: [{ name: 'wallet_ledger_entries_wallet_cursor_index', properties: ['walletId', 'createdAt', 'id'] }],
  uniques: [{ name: 'wallet_ledger_entries_transaction_id_unique', properties: ['transactionId'] }],
});
