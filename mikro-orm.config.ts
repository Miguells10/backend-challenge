import { defineConfig } from '@mikro-orm/postgresql';

import { WalletLedgerEntryEntitySchema } from './src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntitySchema } from './src/infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntitySchema } from './src/infrastructure/persistence/entities/wager-transaction.entity';
import { InboxMessageEntitySchema } from './src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntitySchema } from './src/infrastructure/persistence/entities/outbox-message.entity';

const databaseUrl = resolveDatabaseUrl();

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

function resolveDatabaseUrl(): string {
  if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
    return process.env.DATABASE_URL ?? 'postgresql://wagering:wagering@localhost:5432/wagering';
  }

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (testDatabaseUrl === undefined || testDatabaseUrl === '') {
    throw new Error('TEST_DATABASE_URL must be configured when RUN_INTEGRATION_TESTS is true.');
  }

  if (!new URL(testDatabaseUrl).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a database whose name ends with _test.');
  }

  configureTestQueueUrls();

  return testDatabaseUrl;
}

function configureTestQueueUrls(): void {
  for (const name of [
    'WAGER_TRANSACTIONS_QUEUE_URL',
    'WAGER_TRANSACTIONS_DLQ_URL',
    'WAGER_EVENTS_QUEUE_URL',
  ]) {
    const testValue = process.env[`TEST_${name}`];
    if (testValue === undefined || testValue === '') {
      throw new Error(`TEST_${name} must be configured when RUN_INTEGRATION_TESTS is true.`);
    }

    process.env[name] = testValue;
  }
}
