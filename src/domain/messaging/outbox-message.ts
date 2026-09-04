import { type IntegrationEvent, type IntegrationEventEnvelope } from './integration-event';

const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 300_000;

export interface EnqueueOutboxMessageProps {
  id: string;
  event: IntegrationEvent<unknown>;
}

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: IntegrationEventEnvelope<unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessageStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OutboxMessageStateError';
  }
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: IntegrationEventEnvelope<unknown>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  public static enqueue(props: EnqueueOutboxMessageProps): OutboxMessage {
    const payload = props.event.toJSON();
    return new OutboxMessage(
      props.id,
      payload.aggregateId,
      payload.eventType,
      payload,
      new Date(payload.occurredAt),
      0,
    );
  }

  public static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  public get attempts(): number {
    return this._attempts;
  }

  public get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  public get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  public isPending(): boolean {
    return this._publishedAt === undefined;
  }

  public isDue(now: Date): boolean {
    return this.isPending() && (this._nextAttemptAt === undefined || this._nextAttemptAt <= now);
  }

  public markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new OutboxMessageStateError('An outbox message was already published.');
    }

    this._publishedAt = at;
    this._nextAttemptAt = undefined;
  }

  public scheduleRetry(now: Date): void {
    if (!this.isPending()) {
      throw new OutboxMessageStateError('A published outbox message cannot be retried.');
    }

    this._attempts += 1;
    const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** (this._attempts - 1), MAX_RETRY_DELAY_MS);
    this._nextAttemptAt = new Date(now.getTime() + delay);
  }
}
