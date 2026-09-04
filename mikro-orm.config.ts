import { defineConfig } from '@mikro-orm/postgresql';

import { WalletLedgerEntryEntitySchema } from './src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntitySchema } from './src/infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntitySchema } from './src/infrastructure/persistence/entities/wager-transaction.entity';
import { InboxMessageEntitySchema } from './src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntitySchema } from './src/infrastructure/persistence/entities/outbox-message.entity';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://wagering:wagering@localhost:5432/wagering';

export default defineConfig({
  clientUrl: databaseUrl,
  entities: [
    WalletEntitySchema,
    WagerTransactionEntitySchema,
    WalletLedgerEntryEntitySchema,
    InboxMessageEntitySchema,
    OutboxMessageEntitySchema,
  ],
  migrations: {
    path: 'dist/migrations',
    pathTs: 'src/migrations',
  },
});
