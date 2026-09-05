import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { OutboxMessage, type OutboxMessageState } from '../domain/messaging/outbox-message';
import { MetricsService } from '../observability/metrics.service';
import { StructuredLogger } from '../observability/structured-logger.service';

import { SQS_CLIENT } from './sqs.constants';

const DEFAULT_BATCH_SIZE = 10;

@Injectable()
export class OutboxPublisher {
  private readonly queueUrl: string;

  public constructor(
    private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqsClient: SQSClient,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly logger?: StructuredLogger,
  ) {
    this.queueUrl = requiredEnvironment('WAGER_EVENTS_QUEUE_URL');
  }

  public async publishDue(limit = DEFAULT_BATCH_SIZE): Promise<number> {
    let published = 0;

    for (let index = 0; index < limit; index += 1) {
      const handled = await this.publishNext();
      if (!handled) {
        break;
      }
      published += 1;
    }

    await this.refreshOutboxLag();

    return published;
  }

  private async publishNext(): Promise<boolean> {
    return this.orm.em.fork().transactional((em) => this.publishLockedMessage(em), { clear: true });
  }

  private async publishLockedMessage(em: EntityManager): Promise<boolean> {
    const message = await this.lockNextDueMessage(em, new Date());
    if (message === undefined) {
      return false;
    }

    try {
      await this.send(message);
      message.markPublished(new Date());
      this.logger?.info('outbox_message_published', this.logContext(message));
    } catch (error) {
      message.scheduleRetry(new Date());
      this.metrics?.recordRetry('outbox');
      this.logger?.warn('outbox_message_retry_scheduled', {
        ...this.logContext(message),
        attempt: message.attempts,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    await this.updateMessage(em, message);
    return true;
  }

  private async lockNextDueMessage(em: EntityManager, now: Date): Promise<OutboxMessage | undefined> {
    const rows = await em.getConnection().execute<OutboxMessageState[]>(`
      select
        "id",
        "aggregate_id" as "aggregateId",
        "event_type" as "eventType",
        "payload",
        "occurred_at" as "occurredAt",
        "attempts",
        "next_attempt_at" as "nextAttemptAt",
        "published_at" as "publishedAt"
      from "outbox_messages"
      where "published_at" is null
        and ("next_attempt_at" is null or "next_attempt_at" <= ?)
      order by "occurred_at", "id"
      limit 1
      for update skip locked
    `, [now], 'all', em.getTransactionContext());
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }

    return OutboxMessage.rehydrate({
      ...row,
      nextAttemptAt: row.nextAttemptAt ?? undefined,
      publishedAt: row.publishedAt ?? undefined,
    });
  }

  private async send(message: OutboxMessage): Promise<void> {
    await this.sqsClient.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(message.payload),
      MessageGroupId: message.aggregateId,
      MessageDeduplicationId: message.payload.eventId,
    }));
  }

  private async updateMessage(em: EntityManager, message: OutboxMessage): Promise<void> {
    await em.getConnection().execute(
      `
        update "outbox_messages"
        set "attempts" = ?, "next_attempt_at" = ?, "published_at" = ?
        where "id" = ?
      `,
      [message.attempts, message.nextAttemptAt ?? null, message.publishedAt ?? null, message.id],
      'run',
      em.getTransactionContext(),
    );
  }

  private async refreshOutboxLag(): Promise<void> {
    if (this.metrics === undefined) return;
    const rows = await this.orm.em.fork().getConnection().execute<Array<{ oldest: Date | string | null }>>(
      'select min("occurred_at") as "oldest" from "outbox_messages" where "published_at" is null',
    );
    const oldest = rows[0]?.oldest;
    this.metrics.setOutboxLag(oldest === null || oldest === undefined
      ? 0
      : (Date.now() - new Date(oldest).getTime()) / 1_000);
  }

  private logContext(message: OutboxMessage): {
    correlationId: string;
    outboxMessageId: string;
    eventType: string;
    transactionId?: string;
    walletId?: string;
  } {
    return {
      correlationId: message.payload.correlationId,
      outboxMessageId: message.id,
      eventType: message.eventType,
      transactionId: message.eventType.startsWith('WagerTransaction') ? message.aggregateId : undefined,
      walletId: message.eventType === 'WalletBalanceChanged' ? message.aggregateId : undefined,
    };
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} must be configured.`);
  }
  return value;
}
