import { EntitySchema } from '@mikro-orm/core';

export interface WalletEntity {
  id: string;
  playerId: string;
  currency: string;
  balanceAmount: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const WalletEntitySchema = new EntitySchema<WalletEntity>({
  name: 'WalletEntity',
  tableName: 'wallets',
  properties: {
    id: { type: 'uuid', primary: true },
    playerId: { type: 'uuid', fieldName: 'player_id' },
    currency: { type: 'string', columnType: 'char(3)' },
    balanceAmount: { type: 'decimal', columnType: 'numeric(18,2)', fieldName: 'balance_amount' },
    version: { type: 'integer', version: true },
    createdAt: { type: 'datetime', columnType: 'timestamptz', fieldName: 'created_at' },
    updatedAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      fieldName: 'updated_at',
      onUpdate: () => new Date(),
    },
  },
  uniques: [{ name: 'wallets_player_id_currency_unique', properties: ['playerId', 'currency'] }],
});
