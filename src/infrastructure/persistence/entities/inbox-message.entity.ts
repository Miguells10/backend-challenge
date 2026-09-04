import { EntitySchema } from '@mikro-orm/core';

export interface InboxMessageEntity {
  id: string;
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}

export const InboxMessageEntitySchema = new EntitySchema<InboxMessageEntity>({
  name: 'InboxMessageEntity',
  tableName: 'inbox_messages',
  properties: {
    id: { type: 'uuid', primary: true },
    messageId: { type: 'string', fieldName: 'message_id', length: 255 },
    consumerName: { type: 'string', fieldName: 'consumer_name', length: 128 },
    payloadHash: { type: 'string', fieldName: 'payload_hash', length: 128 },
    receivedAt: { type: 'datetime', columnType: 'timestamptz', fieldName: 'received_at' },
    processedAt: { type: 'datetime', columnType: 'timestamptz', fieldName: 'processed_at', nullable: true },
  },
  uniques: [
    { name: 'inbox_messages_consumer_message_unique', properties: ['consumerName', 'messageId'] },
  ],
});
