export interface ReceiveInboxMessageProps {
  id: string;
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxMessageState extends ReceiveInboxMessageProps {
  processedAt?: Date;
}

export class InvalidInboxMessageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidInboxMessageError';
  }
}

export class InboxMessage {
  private constructor(
    public readonly id: string,
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  public static receive(props: ReceiveInboxMessageProps): InboxMessage {
    InboxMessage.assertRequiredValues(props);
    return new InboxMessage(
      props.id,
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt,
    );
  }

  public static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.id,
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  public isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  public markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InvalidInboxMessageError('An inbox message cannot be processed twice.');
    }

    this._processedAt = at;
  }

  private static assertRequiredValues(props: ReceiveInboxMessageProps): void {
    if ([props.id, props.messageId, props.consumerName, props.payloadHash].some((value) => value.trim() === '')) {
      throw new InvalidInboxMessageError('Inbox message identifiers and payload hash are required.');
    }
  }
}
