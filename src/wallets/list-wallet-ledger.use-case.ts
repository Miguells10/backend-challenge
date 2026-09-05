import { Inject, Injectable } from '@nestjs/common';

import {
  WALLET_REPOSITORY,
  type WalletLedgerCursor,
  type WalletRepository,
} from './wallet.repository';
import { WalletNotFoundError } from './get-wallet.use-case';

const CURSOR_ENCODING = 'base64url';

export class InvalidLedgerCursorError extends Error {
  public constructor() {
    super('O cursor do ledger é inválido.');
    this.name = 'InvalidLedgerCursorError';
  }
}

@Injectable()
export class ListWalletLedgerUseCase {
  public constructor(@Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository) {}

  public async execute(walletId: string, encodedCursor: string | undefined, limit: number) {
    const wallet = await this.wallets.findById(walletId);
    if (wallet === undefined) throw new WalletNotFoundError(walletId);

    const page = await this.wallets.findLedgerPage(walletId, decodeCursor(encodedCursor), limit);
    const lastEntry = page.entries.at(-1);

    return {
      items: page.entries.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: { amount: entry.amount, currency: entry.currency },
        balanceBefore: { amount: entry.balanceBefore, currency: entry.currency },
        balanceAfter: { amount: entry.balanceAfter, currency: entry.currency },
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: page.hasMore && lastEntry !== undefined ? encodeCursor(lastEntry) : null,
      limit,
    };
  }
}

function decodeCursor(encodedCursor: string | undefined): WalletLedgerCursor | undefined {
  if (encodedCursor === undefined) return undefined;

  try {
    const value: unknown = JSON.parse(Buffer.from(encodedCursor, CURSOR_ENCODING).toString('utf8'));
    if (!isCursorValue(value)) throw new InvalidLedgerCursorError();

    const createdAt = new Date(value.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new InvalidLedgerCursorError();

    return { createdAt, id: value.id };
  } catch (error) {
    if (error instanceof InvalidLedgerCursorError) throw error;
    throw new InvalidLedgerCursorError();
  }
}

function encodeCursor(cursor: WalletLedgerCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id })).toString(CURSOR_ENCODING);
}

function isCursorValue(value: unknown): value is { createdAt: string; id: string } {
  if (typeof value !== 'object' || value === null) return false;

  const cursor = value as Record<string, unknown>;
  return typeof cursor.createdAt === 'string' && typeof cursor.id === 'string' && cursor.id.length > 0;
}
