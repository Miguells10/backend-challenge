import { LockMode } from '@mikro-orm/core';
import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  PENDING_REFERENCE_RETRY_POLICY,
  type PendingReferenceRetryPolicy,
} from '../../config/pending-reference-retry-policy';
import { Money } from '../../domain/money/money';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry';
import { OutboxMessage } from '../../domain/messaging/outbox-message';
import {
  WalletBalanceChanged,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '../../domain/messaging/wager-events';
import { InsufficientFundsError, Wallet } from '../../domain/wallet/wallet';
import {
  isExternalWagerTransactionKind,
  InvalidTransactionReferenceError,
  InvalidWagerTransactionError,
  WagerFailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wagering/wager-transaction';
import {
  WalletLedgerEntryEntitySchema,
  type WalletLedgerEntryEntity,
} from '../../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WalletEntitySchema, type WalletEntity } from '../../infrastructure/persistence/entities/wallet.entity';
import {
  OutboxMessageEntitySchema,
  type OutboxMessageEntity,
} from '../../infrastructure/persistence/entities/outbox-message.entity';
import {
  WagerTransactionEntitySchema,
  type WagerTransactionEntity,
} from '../../infrastructure/persistence/entities/wager-transaction.entity';
import { MetricsService } from '../../observability/metrics.service';
import { StructuredLogger } from '../../observability/structured-logger.service';

export interface ProcessWagerTransactionCommand {
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
  occurredAt: Date;
}

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: Money;
  idempotentReplay: boolean;
  failureCode?: WagerFailureCode;
}

export class WalletNotFoundError extends Error {
  public constructor(walletId: string) {
    super(`Wallet ${walletId} was not found.`);
    this.name = 'WalletNotFoundError';
  }
}

export class IdempotencyConflictError extends Error {
  public constructor() {
    super('The idempotency key was already used with a different payload.');
    this.name = 'IdempotencyConflictError';
  }
}

@Injectable()
export class ProcessWagerTransactionUseCase {
  public constructor(
    private readonly orm: MikroORM,
    @Inject(PENDING_REFERENCE_RETRY_POLICY)
    private readonly pendingReferenceRetryPolicy: PendingReferenceRetryPolicy,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly logger?: StructuredLogger,
  ) {}

  public async execute(command: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionResult> {
    return this.observeProcessing(command, 'http', () =>
      this.orm.em.fork().transactional((em) => this.process(em, command), { clear: true }));
  }

  public async executeInTransaction(
    em: EntityManager,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    return this.observeProcessing(command, 'sqs', () => this.process(em, command));
  }

  private async observeProcessing(
    command: ProcessWagerTransactionCommand,
    source: 'http' | 'sqs',
    operation: () => Promise<ProcessWagerTransactionResult>,
  ): Promise<ProcessWagerTransactionResult> {
    const startedAt = performance.now();
    try {
      const result = await operation();
      if (result.idempotentReplay) {
        this.metrics?.recordDuplicate(source);
      } else {
        this.metrics?.recordTransaction(result.status, source);
      }
      this.logger?.info(result.idempotentReplay ? 'wager_transaction_replayed' : 'wager_transaction_processed', {
        correlationId: command.id,
        transactionId: result.transactionId,
        walletId: command.walletId,
        providerId: command.providerId,
        status: result.status,
        source,
      });
      return result;
    } catch (error) {
      if (isDatabaseLockConflict(error)) {
        this.metrics?.recordLockConflict('wallet');
      }
      this.logger?.error('wager_transaction_failed', {
        correlationId: command.id,
        walletId: command.walletId,
        providerId: command.providerId,
        source,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    } finally {
      this.metrics?.observeProcessingLatency(source, (performance.now() - startedAt) / 1_000);
    }
  }

  public async reprocessPendingReferenceInTransaction(
    em: EntityManager,
    transactionId: string,
    occurredAt: Date,
  ): Promise<boolean> {
    const transactionEntity = await em.findOne(
      WagerTransactionEntitySchema,
      { id: transactionId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (transactionEntity === null || transactionEntity.status !== WagerTransactionStatus.PendingReference) {
      return true;
    }

    const walletEntity = await em.findOne(
      WalletEntitySchema,
      { id: transactionEntity.walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (walletEntity === null) {
      throw new WalletNotFoundError(transactionEntity.walletId);
    }

    const transaction = this.toTransaction(transactionEntity);
    const reference = await this.resolveReference(em, transaction);
    if (reference === undefined) {
      return false;
    }

    const wallet = this.toWallet(walletEntity);
    if (!this.isValidReference(transaction, reference)) {
      transaction.reject(WagerFailureCode.InvalidReference);
      await this.persistTransaction(em, transaction, wallet.balance, transactionEntity);
      return true;
    }

    if (await this.hasProcessedReversalOfSameKind(em, transaction, reference)) {
      transaction.reject(WagerFailureCode.ReversalAlreadyProcessed);
      await this.persistTransaction(em, transaction, wallet.balance, transactionEntity);
      return true;
    }

    await this.applyBalanceChange(em, transaction, wallet, walletEntity, reference, occurredAt, transactionEntity);
    return true;
  }

  public async rejectPendingReferenceInTransaction(
    em: EntityManager,
    transactionId: string,
    referenceAttempts: number,
  ): Promise<void> {
    const transactionEntity = await em.findOne(
      WagerTransactionEntitySchema,
      { id: transactionId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (transactionEntity === null || transactionEntity.status !== WagerTransactionStatus.PendingReference) {
      return;
    }

    const transaction = this.toTransaction(transactionEntity);
    transaction.reject(WagerFailureCode.ReferenceNotFound);
    transactionEntity.referenceAttempts = referenceAttempts;
    const balance = Money.from({ amount: transactionEntity.resultBalanceAmount!, currency: transactionEntity.currency });
    await this.persistTransaction(em, transaction, balance, transactionEntity);
  }

  private async process(
    em: EntityManager,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    if (!isExternalWagerTransactionKind(command.kind)) {
      throw new InvalidWagerTransactionError('OPENING transactions can only be created while opening a wallet.');
    }

    const existing = await em.findOne(WagerTransactionEntitySchema, { idempotencyKey: command.idempotencyKey });
    if (existing !== null) {
      return this.replay(existing, command.payloadHash);
    }

    const walletEntity = await em.findOne(WalletEntitySchema, { id: command.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    if (walletEntity === null) {
      throw new WalletNotFoundError(command.walletId);
    }

    const replayAfterLock = await em.findOne(WagerTransactionEntitySchema, { idempotencyKey: command.idempotencyKey });
    if (replayAfterLock !== null) {
      return this.replay(replayAfterLock, command.payloadHash);
    }

    const transaction = WagerTransaction.create({
      id: command.id,
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      payloadHash: command.payloadHash,
      walletId: command.walletId,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
      createdAt: command.occurredAt,
    });
    const wallet = this.toWallet(walletEntity);
    const reference = await this.resolveReference(em, transaction);

    if (transaction.requiresReference() && reference === undefined) {
      transaction.markPendingReference();
      return this.persistTransaction(em, transaction, wallet.balance);
    }

    if (reference !== undefined && !this.isValidReference(transaction, reference)) {
      transaction.reject(WagerFailureCode.InvalidReference);
      return this.persistTransaction(em, transaction, wallet.balance);
    }

    if (reference !== undefined && await this.hasProcessedReversalOfSameKind(em, transaction, reference)) {
      transaction.reject(WagerFailureCode.ReversalAlreadyProcessed);
      return this.persistTransaction(em, transaction, wallet.balance);
    }

    if (!transaction.affectsBalance()) {
      transaction.markProcessed(reference?.id, command.occurredAt);
      return this.persistTransaction(em, transaction, wallet.balance);
    }

    return this.applyBalanceChange(em, transaction, wallet, walletEntity, reference, command.occurredAt);
  }

  private async applyBalanceChange(
    em: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    walletEntity: WalletEntity,
    reference: WagerTransaction | undefined,
    occurredAt: Date,
    existingTransactionEntity?: WagerTransactionEntity,
  ): Promise<ProcessWagerTransactionResult> {
    try {
      const change = transaction.ledgerDirectionFor(reference) === 'CREDIT'
        ? wallet.credit(transaction.money, occurredAt)
        : wallet.debit(transaction.money, occurredAt);
      transaction.markProcessed(reference?.id, occurredAt);

      walletEntity.balanceAmount = wallet.balance.toJSON().amount;
      walletEntity.version = wallet.version;
      walletEntity.updatedAt = wallet.updatedAt;

      const entry = WalletLedgerEntry.create({
        id: crypto.randomUUID(),
        walletId: wallet.id,
        transactionId: transaction.id,
        direction: change.direction,
        money: change.money,
        balanceBefore: change.balanceBefore,
        balanceAfter: change.balanceAfter,
        createdAt: occurredAt,
      });
      // O ledger exige que a transação já exista no banco por uma chave estrangeira.
      // Os dois flushes ainda pertencem à mesma transação SQL: se o ledger falhar,
      // o banco desfaz também a transação e a atualização da wallet.
      em.persist(this.transactionEntity(em, transaction, wallet.balance, existingTransactionEntity));
      await em.flush();

      const outboxMessages = this.createOutboxMessages(transaction, wallet.balance, wallet, entry);
      em.persist([
        this.toLedgerEntryEntity(em, entry),
        ...outboxMessages.map((message) => this.toOutboxMessageEntity(em, message)),
      ]);
      await em.flush();

      return this.result(transaction, wallet.balance, false);
    } catch (error) {
      if (!(error instanceof InsufficientFundsError)) {
        throw error;
      }

      transaction.reject(
        transaction.kind === WagerTransactionKind.Rollback
          ? WagerFailureCode.RollbackWouldOverdraw
          : WagerFailureCode.InsufficientFunds,
      );
      return this.persistTransaction(em, transaction, wallet.balance, existingTransactionEntity);
    }
  }

  private async resolveReference(
    em: EntityManager,
    transaction: WagerTransaction,
  ): Promise<WagerTransaction | undefined> {
    if (transaction.referenceExternalTransactionId === undefined) {
      return undefined;
    }

    const entity = await em.findOne(WagerTransactionEntitySchema, {
      providerId: transaction.providerId,
      externalTransactionId: transaction.referenceExternalTransactionId,
    });

    return entity === null ? undefined : this.toTransaction(entity);
  }

  private isValidReference(transaction: WagerTransaction, reference: WagerTransaction): boolean {
    try {
      transaction.assertCanReference(reference);
      return true;
    } catch (error) {
      if (error instanceof InvalidTransactionReferenceError) {
        return false;
      }
      throw error;
    }
  }

  private async hasProcessedReversalOfSameKind(
    em: EntityManager,
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): Promise<boolean> {
    if (!transaction.requiresReference()) {
      return false;
    }

    return (await em.count(WagerTransactionEntitySchema, {
      referenceTransactionId: reference.id,
      kind: transaction.kind,
      status: WagerTransactionStatus.Processed,
    })) > 0;
  }

  private async persistTransaction(
    em: EntityManager,
    transaction: WagerTransaction,
    balance: Money,
    existingTransactionEntity?: WagerTransactionEntity,
  ): Promise<ProcessWagerTransactionResult> {
    em.persist(this.transactionEntity(em, transaction, balance, existingTransactionEntity));
    await em.flush();

    const outboxMessages = this.createOutboxMessages(transaction, balance);
    em.persist(outboxMessages.map((message) => this.toOutboxMessageEntity(em, message)));
    await em.flush();

    return this.result(transaction, balance, false);
  }

  private createOutboxMessages(
    transaction: WagerTransaction,
    balance: Money,
    wallet?: Wallet,
    entry?: WalletLedgerEntry,
  ): OutboxMessage[] {
    const context = { correlationId: transaction.id };
    const event = this.transactionEvent(transaction, balance, context);
    const messages = [OutboxMessage.enqueue({ id: crypto.randomUUID(), event })];

    if (wallet !== undefined && entry !== undefined) {
      messages.push(OutboxMessage.enqueue({
        id: crypto.randomUUID(),
        event: WalletBalanceChanged.from(wallet, entry, context),
      }));
    }

    return messages;
  }

  private transactionEvent(
    transaction: WagerTransaction,
    balance: Money,
    context: { correlationId: string },
  ): WagerTransactionProcessed | WagerTransactionRejected | WagerTransactionPendingReference {
    switch (transaction.status) {
      case WagerTransactionStatus.Processed:
        return WagerTransactionProcessed.from(transaction, balance, context);
      case WagerTransactionStatus.Rejected:
        return WagerTransactionRejected.from(transaction, balance, context);
      case WagerTransactionStatus.PendingReference:
        return WagerTransactionPendingReference.from(transaction, balance, context);
      default:
        throw new Error(`Cannot enqueue an event for a transaction in ${transaction.status} status.`);
    }
  }

  private replay(entity: WagerTransactionEntity, payloadHash: string): ProcessWagerTransactionResult {
    if (entity.payloadHash !== payloadHash) {
      throw new IdempotencyConflictError();
    }

    if (entity.resultBalanceAmount === undefined) {
      throw new Error('Persisted transaction is missing its observed balance.');
    }

    return {
      transactionId: entity.id,
      status: entity.status,
      balance: Money.from({ amount: entity.resultBalanceAmount, currency: entity.currency }),
      idempotentReplay: true,
      failureCode: entity.failureCode,
    };
  }

  private result(
    transaction: WagerTransaction,
    balance: Money,
    idempotentReplay: boolean,
  ): ProcessWagerTransactionResult {
    return {
      transactionId: transaction.id,
      status: transaction.status,
      balance,
      idempotentReplay,
      failureCode: transaction.failureCode,
    };
  }

  private toWallet(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.from({ amount: entity.balanceAmount, currency: entity.currency }),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  private toTransaction(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: Money.from({ amount: entity.amount, currency: entity.currency }),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      createdAt: entity.createdAt,
      status: entity.status,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode,
      processedAt: entity.processedAt,
    });
  }

  private toTransactionEntity(
    em: EntityManager,
    transaction: WagerTransaction,
    resultBalance: Money,
  ): WagerTransactionEntity {
    return em.create(WagerTransactionEntitySchema, {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      amount: transaction.money.toJSON().amount,
      currency: transaction.money.currency,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      referenceTransactionId: transaction.referenceTransactionId,
      status: transaction.status,
      failureCode: transaction.failureCode,
      resultBalanceAmount: resultBalance.toJSON().amount,
      referenceAttempts: 0,
      nextReferenceAttemptAt: transaction.status === WagerTransactionStatus.PendingReference
        ? new Date(transaction.createdAt.getTime() + this.pendingReferenceRetryPolicy.initialDelayMs)
        : undefined,
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt,
    });
  }

  private transactionEntity(
    em: EntityManager,
    transaction: WagerTransaction,
    balance: Money,
    existing?: WagerTransactionEntity,
  ): WagerTransactionEntity {
    if (existing === undefined) {
      return this.toTransactionEntity(em, transaction, balance);
    }

    existing.referenceTransactionId = transaction.referenceTransactionId;
    existing.status = transaction.status;
    existing.failureCode = transaction.failureCode;
    existing.resultBalanceAmount = balance.toJSON().amount;
    existing.processedAt = transaction.processedAt;
    existing.nextReferenceAttemptAt = transaction.status === WagerTransactionStatus.PendingReference
      ? existing.nextReferenceAttemptAt
      : undefined;
    return existing;
  }

  private toLedgerEntryEntity(em: EntityManager, entry: WalletLedgerEntry): WalletLedgerEntryEntity {
    return em.create(WalletLedgerEntryEntitySchema, {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: entry.money.toJSON().amount,
      currency: entry.money.currency,
      balanceBefore: entry.balanceBefore.toJSON().amount,
      balanceAfter: entry.balanceAfter.toJSON().amount,
      createdAt: entry.createdAt,
    });
  }

  private toOutboxMessageEntity(em: EntityManager, message: OutboxMessage): OutboxMessageEntity {
    return em.create(OutboxMessageEntitySchema, {
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload,
      occurredAt: message.occurredAt,
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt,
      publishedAt: message.publishedAt,
    });
  }
}

function isDatabaseLockConflict(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = error.code;
  if (code === '40P01' || code === '55P03' || code === '40001') return true;
  return isDatabaseLockConflict(error.cause) || isDatabaseLockConflict(error.driverException);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
