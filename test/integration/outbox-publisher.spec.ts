import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';

import { Money } from '../../src/domain/money/money';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction';
import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case';
import { OutboxMessageEntitySchema } from '../../src/infrastructure/persistence/entities/outbox-message.entity';
import { WalletEntitySchema } from '../../src/infrastructure/persistence/entities/wallet.entity';
import { OutboxPublisher } from '../../src/sqs/outbox-publisher';
import mikroOrmConfig from '../../mikro-orm.config';

const describeIntegration = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
const EVENTS_QUEUE_URL = process.env.WAGER_EVENTS_QUEUE_URL ?? '';
const WALLET_ID = '00000000-0000-0000-0000-000000000101';
const PLAYER_ID = '00000000-0000-0000-0000-000000000102';

describeIntegration('OutboxPublisher', () => {
  let orm: MikroORM;
  let testEm: typeof orm.em;
  let sqsClient: SQSClient;
  let useCase: ProcessWagerTransactionUseCase;
  let publisher: OutboxPublisher;

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    sqsClient = createSqsClient();
    useCase = new ProcessWagerTransactionUseCase(orm);
    publisher = new OutboxPublisher(orm, sqsClient);
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
      createdAt: new Date('2026-09-04T21:00:00.000Z'),
      updatedAt: new Date('2026-09-04T21:00:00.000Z'),
    }));
    await testEm.flush();
    await drainQueue(sqsClient);
  });

  afterAll(async () => {
    sqsClient.destroy();
    await orm.close(true);
  });

  test('allows concurrent publishers to publish each pending event once', async () => {
    await useCase.execute({
      id: '00000000-0000-0000-0000-000000000103',
      providerId: 'provider-1',
      externalTransactionId: 'external-1',
      idempotencyKey: 'provider-1:external-1',
      payloadHash: 'payload-hash-1',
      walletId: WALLET_ID,
      playerId: PLAYER_ID,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      occurredAt: new Date('2026-09-04T21:00:00.000Z'),
    });

    await Promise.all([publisher.publishDue(), publisher.publishDue()]);
    testEm.clear();

    const outboxMessages = await testEm.find(OutboxMessageEntitySchema, {});
    const publishedEvents = await receiveEvents();

    expect(outboxMessages.every((message) => message.publishedAt !== undefined)).toBe(true);
    expect(publishedEvents.map((event) => event.eventType).sort()).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
  });

  async function receiveEvents(): Promise<Array<{ eventType: string }>> {
    const events: Array<{ eventType: string }> = [];
    while (events.length < 2) {
      const response = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: EVENTS_QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 2,
      }));

      for (const message of response.Messages ?? []) {
        if (message.Body !== undefined) {
          events.push(JSON.parse(message.Body) as { eventType: string });
        }
        if (message.ReceiptHandle !== undefined) {
          await sqsClient.send(new DeleteMessageCommand({ QueueUrl: EVENTS_QUEUE_URL, ReceiptHandle: message.ReceiptHandle }));
        }
      }
    }
    return events;
  }
});

function createSqsClient(): SQSClient {
  return new SQSClient({
    endpoint: requiredEnvironment('SQS_ENDPOINT'),
    region: requiredEnvironment('AWS_REGION'),
    credentials: {
      accessKeyId: requiredEnvironment('AWS_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnvironment('AWS_SECRET_ACCESS_KEY'),
    },
  });
}

async function drainQueue(sqsClient: SQSClient): Promise<void> {
  while (true) {
    const response = await sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: EVENTS_QUEUE_URL,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 0,
    }));
    const messages = response.Messages ?? [];
    if (messages.length === 0) {
      return;
    }

    await Promise.all(messages.map(async (message) => {
      if (message.ReceiptHandle !== undefined) {
        await sqsClient.send(new DeleteMessageCommand({ QueueUrl: EVENTS_QUEUE_URL, ReceiptHandle: message.ReceiptHandle }));
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
