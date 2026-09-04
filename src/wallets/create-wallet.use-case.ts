import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { WalletLedgerEntry } from '../domain/ledger/wallet-ledger-entry';
import { OutboxMessage } from '../domain/messaging/outbox-message';
import { WalletBalanceChanged, WagerTransactionProcessed } from '../domain/messaging/wager-events';
import { Money } from '../domain/money/money';
import { WagerTransaction, WagerTransactionKind } from '../domain/wagering/wager-transaction';
import { Wallet } from '../domain/wallet/wallet';
import { OutboxMessageEntitySchema } from '../infrastructure/persistence/entities/outbox-message.entity';
import { WalletLedgerEntryEntitySchema } from '../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WagerTransactionEntitySchema } from '../infrastructure/persistence/entities/wager-transaction.entity';
import { WalletEntitySchema } from '../infrastructure/persistence/entities/wallet.entity';

export interface CreateWalletCommand { playerId: string; initialBalance: Money; }
export interface WalletResult { id: string; playerId: string; balance: ReturnType<Money['toJSON']>; version: number; }

@Injectable()
export class CreateWalletUseCase {
  public constructor(private readonly orm: MikroORM) {}

  public async execute(command: CreateWalletCommand): Promise<WalletResult> {
    return this.orm.em.fork().transactional(async (em) => {
      const now = new Date();
      const wallet = Wallet.open({ id: crypto.randomUUID(), playerId: command.playerId, initialBalance: command.initialBalance, createdAt: now });
      em.persist(em.create(WalletEntitySchema, {
        id: wallet.id, playerId: wallet.playerId, currency: wallet.currency,
        balanceAmount: wallet.balance.toJSON().amount, version: wallet.version, createdAt: now, updatedAt: now,
      }));
      await em.flush();

      if (!wallet.balance.isZero()) {
        const transaction = WagerTransaction.create({
          id: crypto.randomUUID(), providerId: 'system', externalTransactionId: `opening:${wallet.id}`,
          idempotencyKey: `system:opening:${wallet.id}`, payloadHash: `opening:${wallet.id}`,
          walletId: wallet.id, playerId: wallet.playerId, roundId: `opening:${wallet.id}`,
          gameId: 'wallet-opening', kind: WagerTransactionKind.Opening, money: wallet.balance, createdAt: now,
        });
        transaction.markProcessed(undefined, now);
        em.persist(em.create(WagerTransactionEntitySchema, {
          id: transaction.id, providerId: transaction.providerId, externalTransactionId: transaction.externalTransactionId,
          idempotencyKey: transaction.idempotencyKey, payloadHash: transaction.payloadHash, walletId: wallet.id,
          playerId: wallet.playerId, roundId: transaction.roundId, gameId: transaction.gameId, kind: transaction.kind,
          amount: wallet.balance.toJSON().amount, currency: wallet.currency, status: transaction.status,
          resultBalanceAmount: wallet.balance.toJSON().amount, referenceAttempts: 0, createdAt: now, processedAt: now,
        }));
        await em.flush();

        const entry = WalletLedgerEntry.create({ id: crypto.randomUUID(), walletId: wallet.id, transactionId: transaction.id,
          direction: 'CREDIT', money: wallet.balance, balanceBefore: Money.zero(wallet.currency), balanceAfter: wallet.balance, createdAt: now });
        const events = [
          WagerTransactionProcessed.from(transaction, wallet.balance, { correlationId: transaction.id }),
          WalletBalanceChanged.from(wallet, entry, { correlationId: transaction.id }),
        ].map((event) => OutboxMessage.enqueue({ id: crypto.randomUUID(), event }));
        em.persist([
          em.create(WalletLedgerEntryEntitySchema, { id: entry.id, walletId: entry.walletId, transactionId: entry.transactionId,
            direction: entry.direction, amount: entry.money.toJSON().amount, currency: wallet.currency,
            balanceBefore: entry.balanceBefore.toJSON().amount, balanceAfter: entry.balanceAfter.toJSON().amount, createdAt: now }),
          ...events.map((message) => em.create(OutboxMessageEntitySchema, { id: message.id, aggregateId: message.aggregateId,
            eventType: message.eventType, payload: message.payload, occurredAt: message.occurredAt, attempts: message.attempts })),
        ]);
      }
      await em.flush();
      return { id: wallet.id, playerId: wallet.playerId, balance: wallet.balance.toJSON(), version: wallet.version };
    }, { clear: true });
  }
}
