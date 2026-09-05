import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';

import { InboxMessageEntitySchema } from '../../src/infrastructure/persistence/entities/inbox-message.entity';
import { WalletLedgerEntryEntitySchema } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntitySchema } from '../../src/infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntitySchema } from '../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { WagerTransactionSqsConsumer } from '../../src/sqs/wager-transaction-sqs-consumer';
import mikroOrmConfig from '../../mikro-orm.config';

const describeDistributed = process.env.RUN_DISTRIBUTED_WORKER_TESTS === 'true' ? describe : describe.skip;
const QUEUE_URL = process.env.WAGER_TRANSACTIONS_QUEUE_URL ?? '';
const DLQ_URL = process.env.WAGER_TRANSACTIONS_DLQ_URL ?? '';

describeDistributed('worker replicas', () => {
  let orm: MikroORM;
  let testEm: typeof orm.em;
  let sqsClient: SQSClient;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    sqsClient = new SQSClient({
      endpoint: requiredEnvironment('SQS_ENDPOINT'),
      region: requiredEnvironment('AWS_REGION'),
      credentials: {
        accessKeyId: requiredEnvironment('AWS_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnvironment('AWS_SECRET_ACCESS_KEY'),
      },
    });
  });

  beforeEach(async () => {
    testEm = orm.em.fork();
    await testEm.getConnection().execute('truncate table outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
    await drainQueue(sqsClient, QUEUE_URL);
    await drainQueue(sqsClient, DLQ_URL);
    for (const wallet of wallets()) {
      testEm.persist(testEm.create(WalletEntitySchema, {
        ...wallet,
        currency: 'BRL',
        balanceAmount: '100.00',
        version: 1,
        createdAt: new Date('2026-09-04T22:00:00.000Z'),
        updatedAt: new Date('2026-09-04T22:00:00.000Z'),
      }));
    }
    await testEm.flush();
  });

  afterAll(async () => {
    await sqsClient.destroy();
    await orm.close(true);
  });

  test('keeps distinct wallets consistent while three worker containers consume the shared queue', async () => {
    await Promise.all(wallets().map((wallet, index) => sendBet(wallet, index)));
    await waitForProcessedState(3);
    testEm.clear();

    const persistedWallets = await testEm.find(WalletEntitySchema, {});
    const transactions = await testEm.count(WagerTransactionEntitySchema, {});
    const ledgerEntries = await testEm.count(WalletLedgerEntryEntitySchema, {});
    const inboxMessages = await testEm.count(InboxMessageEntitySchema, {
      consumerName: WagerTransactionSqsConsumer.consumerName,
    });

    expect(persistedWallets.map((wallet) => wallet.balanceAmount).sort()).toEqual(['75.00', '75.00', '75.00']);
    expect(persistedWallets.map((wallet) => wallet.version).sort()).toEqual([2, 2, 2]);
    expect(transactions).toBe(3);
    expect(ledgerEntries).toBe(3);
    expect(inboxMessages).toBe(3);
  }, 15_000);

  async function sendBet(wallet: WorkerWallet, index: number): Promise<void> {
    const externalTransactionId = `replica-bet-${index + 1}`;
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageGroupId: wallet.id,
      MessageDeduplicationId: crypto.randomUUID(),
      MessageBody: JSON.stringify({
        messageId: `replica-message-${index + 1}`,
        type: 'WagerTransactionRequested',
        occurredAt: '2026-09-04T22:00:00.000Z',
        data: {
          providerId: 'replica-provider',
          externalTransactionId,
          idempotencyKey: `replica-provider:${externalTransactionId}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: `replica-round-${index + 1}`,
          gameId: 'replica-game',
          kind: 'BET',
          money: { amount: '25.00', currency: 'BRL' },
        },
      }),
    }));
  }

  async function waitForProcessedState(expectedCount: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const em = orm.em.fork();
      const [transactions, ledgerEntries, inboxMessages] = await Promise.all([
        em.count(WagerTransactionEntitySchema, {}),
        em.count(WalletLedgerEntryEntitySchema, {}),
        em.count(InboxMessageEntitySchema, { consumerName: WagerTransactionSqsConsumer.consumerName }),
      ]);
      if (transactions === expectedCount && ledgerEntries === expectedCount && inboxMessages === expectedCount) {
        return;
      }
      await delay(100);
    }
    throw new Error(`Expected ${expectedCount} complete transaction, ledger, and inbox records from worker replicas.`);
  }
});

function wallets(): WorkerWallet[] {
  return [
    { id: '00000000-0000-0000-0000-000000000401', playerId: '00000000-0000-0000-0000-000000000411' },
    { id: '00000000-0000-0000-0000-000000000402', playerId: '00000000-0000-0000-0000-000000000412' },
    { id: '00000000-0000-0000-0000-000000000403', playerId: '00000000-0000-0000-0000-000000000413' },
  ];
}

async function drainQueue(sqsClient: SQSClient, queueUrl: string): Promise<void> {
  while (true) {
    const response = await sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 0,
    }));
    const messages = response.Messages ?? [];
    if (messages.length === 0) return;
    await Promise.all(messages.map(async (message) => {
      if (message.ReceiptHandle !== undefined) {
        await sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      }
    }));
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} must be configured for the distributed worker test.`);
  return value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface WorkerWallet {
  id: string;
  playerId: string;
}
