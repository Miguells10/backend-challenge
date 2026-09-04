import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';

import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case';
import { pendingReferenceRetryPolicyFromEnvironment } from '../../src/config/pending-reference-retry-policy';
import { InboxMessageEntitySchema } from '../../src/infrastructure/persistence/entities/inbox-message.entity';
import { WalletLedgerEntryEntitySchema } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntitySchema } from '../../src/infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionSqsConsumer } from '../../src/sqs/wager-transaction-sqs-consumer';
import mikroOrmConfig from '../../mikro-orm.config';

const describeIntegration = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
const QUEUE_URL = process.env.WAGER_TRANSACTIONS_QUEUE_URL ?? '';
const WALLET_ID = '00000000-0000-0000-0000-000000000101';
const PLAYER_ID = '00000000-0000-0000-0000-000000000102';

describeIntegration('WagerTransactionSqsConsumer', () => {
  let orm: MikroORM;
  let testEm: typeof orm.em;
  let sqsClient: SQSClient;
  let consumer: WagerTransactionSqsConsumer;

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
    consumer = new WagerTransactionSqsConsumer(
      orm,
      new ProcessWagerTransactionUseCase(orm, pendingReferenceRetryPolicyFromEnvironment({})),
      sqsClient,
    );
  });

  beforeEach(async () => {
    testEm = orm.em.fork();
    await testEm.getConnection().execute('truncate table outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
    testEm.persist(testEm.create(WalletEntitySchema, {
      id: WALLET_ID,
      playerId: PLAYER_ID,
      currency: 'BRL',
      balanceAmount: '100.00',
      version: 1,
      createdAt: new Date('2026-09-04T20:00:00.000Z'),
      updatedAt: new Date('2026-09-04T20:00:00.000Z'),
    }));
    await testEm.flush();
    await drainQueue(sqsClient);
  });

  afterAll(async () => {
    await sqsClient.destroy();
    await orm.close(true);
  });

  test('deduplicates a redelivered business message before it can debit twice', async () => {
    await sendRequestedTransaction();
    await consumer.pollOnce();
    await sendRequestedTransaction();
    await consumer.pollOnce();
    testEm.clear();

    const wallet = await testEm.findOneOrFail(WalletEntitySchema, WALLET_ID);
    const inboxMessages = await testEm.count(InboxMessageEntitySchema, {
      consumerName: WagerTransactionSqsConsumer.consumerName,
      messageId: 'business-message-1',
    });
    const ledgerEntries = await testEm.count(WalletLedgerEntryEntitySchema, { walletId: WALLET_ID });

    expect(wallet.balanceAmount).toBe('75.00');
    expect(inboxMessages).toBe(1);
    expect(ledgerEntries).toBe(1);
  });

  async function sendRequestedTransaction(): Promise<void> {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageGroupId: WALLET_ID,
      MessageDeduplicationId: crypto.randomUUID(),
      MessageBody: JSON.stringify({
        messageId: 'business-message-1',
        type: 'WagerTransactionRequested',
        occurredAt: '2026-09-04T20:00:00.000Z',
        data: {
          providerId: 'provider-1',
          externalTransactionId: 'external-1',
          idempotencyKey: 'provider-1:external-1',
          playerId: PLAYER_ID,
          walletId: WALLET_ID,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: 'BET',
          money: { amount: '25.00', currency: 'BRL' },
        },
      }),
    }));
  }
});

async function drainQueue(sqsClient: SQSClient): Promise<void> {
  while (true) {
    const response = await sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 0,
    }));
    const messages = response.Messages ?? [];

    if (messages.length === 0) {
      return;
    }

    await Promise.all(messages.map(async (message) => {
      if (message.ReceiptHandle !== undefined) {
        await sqsClient.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: message.ReceiptHandle }));
      }
    }));
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(`${name} must be configured for the integration test.`);
  }

  return value;
}
