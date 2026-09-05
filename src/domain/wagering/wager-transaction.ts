import { type Money } from '../money/money';
import { type LedgerDirection } from '../wallet/wallet';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export const EXTERNAL_WAGER_TRANSACTION_KINDS = [
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
] as const;

export function isExternalWagerTransactionKind(kind: string): kind is WagerTransactionKind {
  return EXTERNAL_WAGER_TRANSACTION_KINDS.includes(kind as (typeof EXTERNAL_WAGER_TRANSACTION_KINDS)[number]);
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export enum WagerFailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  InvalidReference = 'INVALID_REFERENCE',
  ReversalAlreadyProcessed = 'REVERSAL_ALREADY_PROCESSED',
  RollbackWouldOverdraw = 'ROLLBACK_WOULD_OVERDRAW',
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: WagerFailureCode;
  processedAt?: Date;
}

export class InvalidWagerTransactionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidWagerTransactionError';
  }
}

export class InvalidTransactionStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionStateError';
  }
}

export class InvalidTransactionReferenceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionReferenceError';
  }
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: WagerFailureCode,
    private _processedAt?: Date,
  ) {}

  public static create(props: CreateWagerTransactionProps): WagerTransaction {
    WagerTransaction.assertCreationRules(props);
    return WagerTransaction.fromState({ ...props, status: WagerTransactionStatus.Pending });
  }

  public static rehydrate(state: WagerTransactionState): WagerTransaction {
    return WagerTransaction.fromState(state);
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  public get failureCode(): WagerFailureCode | undefined {
    return this._failureCode;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  public markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertCanTransition();

    if (this.requiresReference() && referenceTransactionId === undefined) {
      throw new InvalidWagerTransactionError('A reference transaction is required to process this operation.');
    }

    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._status = WagerTransactionStatus.Processed;
  }

  public markPendingReference(): void {
    if (this._status !== WagerTransactionStatus.Pending) {
      throw new InvalidTransactionStateError('Only pending transactions can wait for a reference.');
    }

    if (!this.requiresReference()) {
      throw new InvalidWagerTransactionError('This operation does not require a reference.');
    }

    this._status = WagerTransactionStatus.PendingReference;
  }

  public reject(code: WagerFailureCode): void {
    this.assertCanTransition();
    this._failureCode = code;
    this._status = WagerTransactionStatus.Rejected;
  }

  public fail(code: WagerFailureCode): void {
    this.assertCanTransition();
    this._failureCode = code;
    this._status = WagerTransactionStatus.Failed;
  }

  public isTerminal(): boolean {
    return [WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected, WagerTransactionStatus.Failed].includes(
      this._status,
    );
  }

  public affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  public requiresReference(): boolean {
    return [WagerTransactionKind.Refund, WagerTransactionKind.Rollback].includes(this.kind);
  }

  public matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return 'CREDIT';
      case WagerTransactionKind.Bet:
        return 'DEBIT';
      case WagerTransactionKind.Rollback:
        if (reference === undefined) {
          throw new InvalidTransactionReferenceError('Rollback requires the referenced transaction.');
        }
        return reference.ledgerDirectionFor() === 'CREDIT' ? 'DEBIT' : 'CREDIT';
      case WagerTransactionKind.Loss:
        throw new InvalidWagerTransactionError('Loss does not create a ledger entry.');
    }
  }

  public assertCanReference(reference: WagerTransaction): void {
    if (!hasValue(this.referenceExternalTransactionId)) {
      throw new InvalidTransactionReferenceError('This operation does not include a reference.');
    }

    if (!reference.isProcessed()) {
      throw new InvalidTransactionReferenceError('The referenced transaction must be processed.');
    }

    this.assertMatchingReference(reference);
    this.assertAllowedReferenceKind(reference);
  }

  private static assertCreationRules(props: CreateWagerTransactionProps): void {
    if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError('Wager transactions must have a positive amount.');
    }

    if (requiresReference(props.kind) && !hasValue(props.referenceExternalTransactionId)) {
      throw new InvalidWagerTransactionError('Refund and rollback require a reference external transaction id.');
    }
  }

  private static fromState(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  private assertCanTransition(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError('Terminal transactions cannot transition again.');
    }
  }

  private assertMatchingReference(reference: WagerTransaction): void {
    const sameContext =
      this.referenceExternalTransactionId === reference.externalTransactionId &&
      this.providerId === reference.providerId &&
      this.playerId === reference.playerId &&
      this.walletId === reference.walletId &&
      this.roundId === reference.roundId &&
      this.money.currency === reference.money.currency &&
      this.money.equals(reference.money);

    if (!sameContext) {
      throw new InvalidTransactionReferenceError('The referenced transaction does not match this reversal.');
    }
  }

  private assertAllowedReferenceKind(reference: WagerTransaction): void {
    const isAllowed =
      (this.kind === WagerTransactionKind.Win && reference.kind === WagerTransactionKind.Bet) ||
      (this.kind === WagerTransactionKind.Refund && reference.kind === WagerTransactionKind.Bet) ||
      (this.kind === WagerTransactionKind.Rollback &&
        [WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund].includes(reference.kind));

    if (!isAllowed) {
      throw new InvalidTransactionReferenceError('This transaction kind cannot reverse the referenced transaction.');
    }
  }

  private isProcessed(): boolean {
    return this._status === WagerTransactionStatus.Processed;
  }
}

function requiresReference(kind: WagerTransactionKind): boolean {
  return [WagerTransactionKind.Refund, WagerTransactionKind.Rollback].includes(kind);
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
