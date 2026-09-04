import { LockMode } from '@mikro-orm/core';
import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

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
  InvalidTransactionReferenceError,
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
  public constructor(private readonly orm: MikroORM) {}

  public async execute(command: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionResult> {
    return this.orm.em.fork().transactional((em) => this.executeInTransaction(em, command), { clear: true });
  }

  public async executeInTransaction(
    em: EntityManager,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    return this.process(em, command);
  }

  private async process(
    em: EntityManager,
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
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
      em.persist(this.toTransactionEntity(em, transaction, wallet.balance));
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
      return this.persistTransaction(em, transaction, wallet.balance);
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

  private async persistTransaction(
    em: EntityManager,
    transaction: WagerTransaction,
    balance: Money,
  ): Promise<ProcessWagerTransactionResult> {
    em.persist(this.toTransactionEntity(em, transaction, balance));
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
      createdAt: transaction.createdAt,
      processedAt: transaction.processedAt,
    });
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
