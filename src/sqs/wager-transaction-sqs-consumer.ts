import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';

import { canonicalPayloadHash } from '../application/idempotency/canonical-payload-hash';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionCommand,
} from '../application/wagering/process-wager-transaction.use-case';
import { InboxMessage } from '../domain/messaging/inbox-message';
import { Money, MoneyValidationError, type MoneyProps } from '../domain/money/money';
import {
  isExternalWagerTransactionKind,
  WagerTransactionKind,
} from '../domain/wagering/wager-transaction';
import { InboxMessageEntitySchema, type InboxMessageEntity } from '../infrastructure/persistence/entities/inbox-message.entity';

import { SQS_CLIENT } from './sqs.constants';

interface WagerTransactionRequestedMessage {
  messageId: string;
  type: 'WagerTransactionRequested';
  occurredAt: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: MoneyProps;
    referenceExternalTransactionId?: string;
  };
}

export class InvalidSqsWagerMessageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidSqsWagerMessageError';
  }
}

@Injectable()
export class WagerTransactionSqsConsumer {
  public static readonly consumerName = 'wager-transaction-consumer';

  private readonly queueUrl: string;
  private readonly deadLetterQueueUrl: string;

  public constructor(
    private readonly orm: MikroORM,
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    @Inject(SQS_CLIENT) private readonly sqsClient: SQSClient,
  ) {
    this.queueUrl = requiredEnvironment('WAGER_TRANSACTIONS_QUEUE_URL');
    this.deadLetterQueueUrl = requiredEnvironment('WAGER_TRANSACTIONS_DLQ_URL');
  }

  public async pollOnce(): Promise<number> {
    const response = await this.sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 30,
    }));
    const messages = response.Messages ?? [];

    await Promise.all(messages.map((message) => this.consume(message)));
    return messages.length;
  }

  public async consume(message: Message): Promise<void> {
    const receiptHandle = message.ReceiptHandle;
    if (receiptHandle === undefined) {
      throw new InvalidSqsWagerMessageError('SQS message does not include a receipt handle.');
    }

    try {
      const requested = parseRequestedMessage(message.Body);
      await this.commitMessage(requested);
    } catch (error) {
      if (!(error instanceof InvalidSqsWagerMessageError)) {
        throw error;
      }

      await this.moveInvalidMessageToDeadLetterQueue(message, error);
      await this.deleteSourceMessage(receiptHandle);
      return;
    }

    await this.deleteSourceMessage(receiptHandle);
  }

  private async deleteSourceMessage(receiptHandle: string): Promise<void> {
    await this.sqsClient.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    }));
  }

  private async moveInvalidMessageToDeadLetterQueue(
    message: Message,
    error: InvalidSqsWagerMessageError,
  ): Promise<void> {
    await this.sqsClient.send(new SendMessageCommand({
      QueueUrl: this.deadLetterQueueUrl,
      MessageBody: message.Body ?? JSON.stringify({ type: 'InvalidWagerMessage', reason: error.message }),
      MessageGroupId: message.MessageId ?? 'invalid-wager-message',
      MessageDeduplicationId: message.MessageId ?? crypto.randomUUID(),
      MessageAttributes: {
        failureCode: { DataType: 'String', StringValue: 'INVALID_WAGER_MESSAGE' },
        failureReason: { DataType: 'String', StringValue: error.message },
        sourceMessageId: { DataType: 'String', StringValue: message.MessageId ?? 'unknown' },
      },
    }));
    console.error(JSON.stringify({
      event: 'wager_message_moved_to_dlq',
      messageId: message.MessageId,
      failureCode: 'INVALID_WAGER_MESSAGE',
    }));
  }

  private async commitMessage(requested: WagerTransactionRequestedMessage): Promise<void> {
    try {
      await this.orm.em.fork().transactional(
        (em) => this.persistInboxAndProcessWager(em, requested),
        { clear: true },
      );
    } catch (error) {
      if (!isUniqueConstraintViolation(error) || !(await this.wasAlreadyProcessed(requested.messageId))) {
        throw error;
      }
    }
  }

  private async persistInboxAndProcessWager(
    em: EntityManager,
    requested: WagerTransactionRequestedMessage,
  ): Promise<void> {
    const existing = await em.findOne(InboxMessageEntitySchema, {
      consumerName: WagerTransactionSqsConsumer.consumerName,
      messageId: requested.messageId,
    });
    if (existing !== null) {
      this.assertProcessed(existing);
      return;
    }

    const inbox = InboxMessage.receive({
      id: crypto.randomUUID(),
      messageId: requested.messageId,
      consumerName: WagerTransactionSqsConsumer.consumerName,
      payloadHash: canonicalPayloadHash(requested.data),
      receivedAt: new Date(),
    });
    const inboxEntity = em.create(InboxMessageEntitySchema, {
      id: inbox.id,
      messageId: inbox.messageId,
      consumerName: inbox.consumerName,
      payloadHash: inbox.payloadHash,
      receivedAt: inbox.receivedAt,
    });
    em.persist(inboxEntity);
    await em.flush();

    await this.processWagerTransaction.executeInTransaction(em, toCommand(requested));
    inbox.markProcessed(new Date());
    inboxEntity.processedAt = inbox.processedAt;
    await em.flush();
  }

  private async wasAlreadyProcessed(messageId: string): Promise<boolean> {
    const em = this.orm.em.fork();
    const existing = await em.findOne(InboxMessageEntitySchema, {
      consumerName: WagerTransactionSqsConsumer.consumerName,
      messageId,
    });
    return existing?.processedAt !== undefined;
  }

  private assertProcessed(message: InboxMessageEntity): void {
    if (message.processedAt === undefined) {
      throw new Error('Committed inbox message is unexpectedly not processed.');
    }
  }
}

function toCommand(message: WagerTransactionRequestedMessage): ProcessWagerTransactionCommand {
  const occurredAt = new Date(message.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new InvalidSqsWagerMessageError('Wager transaction message has an invalid occurredAt value.');
  }

  const kind = parseKind(message.data.kind);
  return {
    id: crypto.randomUUID(),
    providerId: message.data.providerId,
    externalTransactionId: message.data.externalTransactionId,
    idempotencyKey: message.data.idempotencyKey,
    payloadHash: canonicalPayloadHash(message.data),
    walletId: message.data.walletId,
    playerId: message.data.playerId,
    roundId: message.data.roundId,
    gameId: message.data.gameId,
    kind,
    money: parseMoney(message.data.money),
    referenceExternalTransactionId: message.data.referenceExternalTransactionId,
    occurredAt,
  };
}

function parseMoney(money: MoneyProps): Money {
  try {
    return Money.from(money);
  } catch (error) {
    if (error instanceof MoneyValidationError) {
      throw new InvalidSqsWagerMessageError(error.message);
    }
    throw error;
  }
}

function parseRequestedMessage(body: string | undefined): WagerTransactionRequestedMessage {
  if (body === undefined) {
    throw new InvalidSqsWagerMessageError('SQS message does not include a body.');
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InvalidSqsWagerMessageError('SQS message body must be valid JSON.');
  }

  if (!isRequestedMessage(value)) {
    throw new InvalidSqsWagerMessageError('SQS message does not match WagerTransactionRequested.');
  }

  return value;
}

function isRequestedMessage(value: unknown): value is WagerTransactionRequestedMessage {
  if (!isRecord(value) || value.type !== 'WagerTransactionRequested' || !isRecord(value.data)) {
    return false;
  }

  const data = value.data;
  return typeof value.messageId === 'string'
    && typeof value.occurredAt === 'string'
    && typeof data.providerId === 'string'
    && typeof data.externalTransactionId === 'string'
    && typeof data.idempotencyKey === 'string'
    && typeof data.playerId === 'string'
    && typeof data.walletId === 'string'
    && typeof data.roundId === 'string'
    && typeof data.gameId === 'string'
    && typeof data.kind === 'string'
    && isMoneyProps(data.money)
    && (data.referenceExternalTransactionId === undefined || typeof data.referenceExternalTransactionId === 'string');
}

function isMoneyProps(value: unknown): value is MoneyProps {
  return isRecord(value) && typeof value.amount === 'string' && typeof value.currency === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseKind(value: string): WagerTransactionKind {
  if (!isExternalWagerTransactionKind(value)) {
    throw new InvalidSqsWagerMessageError(`Unsupported wager transaction kind ${value}.`);
  }

  return value;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Error && error.name === 'UniqueConstraintViolationException';
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}
