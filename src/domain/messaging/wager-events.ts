import { type WalletLedgerEntry } from '../ledger/wallet-ledger-entry';
import { type Money, type MoneyProps } from '../money/money';
import { type WagerTransaction } from '../wagering/wager-transaction';
import { type Wallet } from '../wallet/wallet';

import { IntegrationEvent, type IntegrationEventContext, type IntegrationEventProps } from './integration-event';

interface WagerTransactionEventData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  roundId: string;
  gameId: string;
  kind: string;
  status: string;
  money: MoneyProps;
  balance: MoneyProps;
}

interface WagerTransactionRejectedData extends WagerTransactionEventData {
  failureCode: string;
}

interface WagerTransactionPendingReferenceData extends WagerTransactionEventData {
  referenceExternalTransactionId: string;
}

interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: string;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionEventData> {
  public readonly eventType = 'WagerTransactionProcessed';
  public readonly version = 1;

  public static from(
    transaction: WagerTransaction,
    balance: Money,
    context: IntegrationEventContext,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed(eventProps(transaction, balance, context));
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  public readonly eventType = 'WagerTransactionRejected';
  public readonly version = 1;

  public static from(
    transaction: WagerTransaction,
    balance: Money,
    context: IntegrationEventContext,
  ): WagerTransactionRejected {
    if (transaction.failureCode === undefined) {
      throw new Error('Rejected wager transaction must include a failure code.');
    }

    return new WagerTransactionRejected({
      ...eventProps(transaction, balance, context),
      data: {
        ...transactionData(transaction, balance),
        failureCode: transaction.failureCode,
      },
    });
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  public readonly eventType = 'WagerTransactionPendingReference';
  public readonly version = 1;

  public static from(
    transaction: WagerTransaction,
    balance: Money,
    context: IntegrationEventContext,
  ): WagerTransactionPendingReference {
    if (transaction.referenceExternalTransactionId === undefined) {
      throw new Error('Pending reference transaction must include a reference external transaction id.');
    }

    return new WagerTransactionPendingReference({
      ...eventProps(transaction, balance, context),
      data: {
        ...transactionData(transaction, balance),
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      },
    });
  }
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  public readonly eventType = 'WalletBalanceChanged';
  public readonly version = 1;

  public static from(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    context: IntegrationEventContext,
  ): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: crypto.randomUUID(),
      aggregateId: wallet.id,
      correlationId: context.correlationId,
      causationId: context.causationId,
      occurredAt: entry.createdAt,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
}

function eventProps(
  transaction: WagerTransaction,
  balance: Money,
  context: IntegrationEventContext,
): IntegrationEventProps<WagerTransactionEventData> {
  return {
    eventId: crypto.randomUUID(),
    aggregateId: transaction.id,
    correlationId: context.correlationId,
    causationId: context.causationId,
    occurredAt: transaction.processedAt ?? transaction.createdAt,
    data: transactionData(transaction, balance),
  };
}

function transactionData(transaction: WagerTransaction, balance: Money): WagerTransactionEventData {
  return {
    transactionId: transaction.id,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    status: transaction.status,
    money: transaction.money.toJSON(),
    balance: balance.toJSON(),
  };
}
