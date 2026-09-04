import { describe, expect, test } from 'bun:test';

import { InboxMessage, InvalidInboxMessageError } from '../../../src/domain/messaging/inbox-message';
import { OutboxMessage, OutboxMessageStateError } from '../../../src/domain/messaging/outbox-message';
import { WagerTransactionProcessed } from '../../../src/domain/messaging/wager-events';
import { Money } from '../../../src/domain/money/money';
import { WagerTransaction, WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction';

const RECEIVED_AT = new Date('2026-09-04T19:00:00.000Z');

describe('InboxMessage', () => {
  test('identifies a received message as unprocessed and marks it after the transaction commits', () => {
    const message = InboxMessage.receive({
      id: 'inbox-1',
      messageId: 'sqs-message-1',
      consumerName: 'wager-transaction-consumer',
      payloadHash: 'hash-1',
      receivedAt: RECEIVED_AT,
    });

    message.markProcessed(new Date('2026-09-04T19:01:00.000Z'));

    expect(message.isProcessed()).toBe(true);
  });

  test('rejects a blank consumer or message identifier', () => {
    expect(() => InboxMessage.receive({
      id: 'inbox-1',
      messageId: '',
      consumerName: 'wager-transaction-consumer',
      payloadHash: 'hash-1',
      receivedAt: RECEIVED_AT,
    })).toThrow(InvalidInboxMessageError);
  });
});

describe('OutboxMessage', () => {
  test('serializes a typed event and schedules exponential retry while it is pending', () => {
    const transaction = processedTransaction();
    const event = WagerTransactionProcessed.from(transaction, money('75.00'), {
      correlationId: transaction.id,
    });
    const message = OutboxMessage.enqueue({ id: '00000000-0000-0000-0000-000000000401', event });

    message.scheduleRetry(RECEIVED_AT);

    expect(message.nextAttemptAt?.toISOString()).toBe('2026-09-04T19:00:05.000Z');
  });

  test('does not retry a message that was already published', () => {
    const transaction = processedTransaction();
    const message = OutboxMessage.enqueue({
      id: '00000000-0000-0000-0000-000000000401',
      event: WagerTransactionProcessed.from(transaction, money('75.00'), { correlationId: transaction.id }),
    });
    message.markPublished(RECEIVED_AT);

    expect(() => message.scheduleRetry(RECEIVED_AT)).toThrow(OutboxMessageStateError);
  });
});

function processedTransaction(): WagerTransaction {
  const transaction = WagerTransaction.create({
    id: '00000000-0000-0000-0000-000000000301',
    providerId: 'provider-1',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-1:external-1',
    payloadHash: 'hash-1',
    walletId: '00000000-0000-0000-0000-000000000101',
    playerId: '00000000-0000-0000-0000-000000000102',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: money('25.00'),
    createdAt: RECEIVED_AT,
  });
  transaction.markProcessed(undefined, RECEIVED_AT);
  return transaction;
}

function money(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}
