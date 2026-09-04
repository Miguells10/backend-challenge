import { EntitySchema } from '@mikro-orm/core';

import { type IntegrationEventEnvelope } from '../../../domain/messaging/integration-event';

export interface OutboxMessageEntity {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: IntegrationEventEnvelope<unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export const OutboxMessageEntitySchema = new EntitySchema<OutboxMessageEntity>({
  name: 'OutboxMessageEntity',
  tableName: 'outbox_messages',
  properties: {
    id: { type: 'uuid', primary: true },
    aggregateId: { type: 'uuid', fieldName: 'aggregate_id' },
    eventType: { type: 'string', fieldName: 'event_type', length: 128 },
    payload: { type: 'json', columnType: 'jsonb' },
    occurredAt: { type: 'datetime', columnType: 'timestamptz', fieldName: 'occurred_at' },
    attempts: { type: 'integer' },
    nextAttemptAt: { type: 'datetime', columnType: 'timestamptz', fieldName: 'next_attempt_at', nullable: true },
    publishedAt: { type: 'datetime', columnType: 'timestamptz', fieldName: 'published_at', nullable: true },
  },
  indexes: [
    {
      name: 'outbox_messages_pending_cursor_index',
      properties: ['publishedAt', 'nextAttemptAt', 'occurredAt'],
    },
  ],
});
