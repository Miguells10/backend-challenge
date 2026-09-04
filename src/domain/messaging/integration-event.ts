export interface IntegrationEventContext {
  correlationId: string;
  causationId?: string;
}

export interface IntegrationEventProps<T> extends IntegrationEventContext {
  eventId: string;
  aggregateId: string;
  occurredAt: Date;
  data: Readonly<T>;
}

export interface IntegrationEventEnvelope<T> {
  eventId: string;
  eventType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  version: number;
  data: Readonly<T>;
}

export abstract class IntegrationEvent<T> {
  public abstract readonly eventType: string;
  public abstract readonly version: number;

  protected constructor(private readonly props: IntegrationEventProps<T>) {}

  public toJSON(): IntegrationEventEnvelope<T> {
    return {
      eventId: this.props.eventId,
      eventType: this.eventType,
      aggregateId: this.props.aggregateId,
      correlationId: this.props.correlationId,
      causationId: this.props.causationId,
      occurredAt: this.props.occurredAt.toISOString(),
      version: this.version,
      data: this.props.data,
    };
  }
}
