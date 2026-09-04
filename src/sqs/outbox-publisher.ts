import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';

import { OutboxMessage, type OutboxMessageState } from '../domain/messaging/outbox-message';

import { SQS_CLIENT } from './sqs.constants';

const DEFAULT_BATCH_SIZE = 10;

@Injectable()
export class OutboxPublisher {
  private readonly queueUrl: string;

  public constructor(
    private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqsClient: SQSClient,
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
    } catch {
      message.scheduleRetry(new Date());
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
    `, [now]);
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
    );
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} must be configured.`);
  }
  return value;
}
