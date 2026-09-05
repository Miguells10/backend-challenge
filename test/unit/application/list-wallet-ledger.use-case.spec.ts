import { describe, expect, test } from 'bun:test';

import {
  ListWalletLedgerUseCase,
} from '../../../src/wallets/list-wallet-ledger.use-case';
import {
  type WalletLedgerCursor,
  type WalletLedgerPage,
  type WalletRepository,
  type WalletSnapshot,
} from '../../../src/wallets/wallet.repository';

const wallet: WalletSnapshot = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  playerId: '550e8400-e29b-41d4-a716-446655440001',
  balanceAmount: '75.00',
  currency: 'BRL',
  version: 2,
};

describe('ListWalletLedgerUseCase', () => {
  test('returns ledger entries and an opaque cursor when another page exists', async () => {
    const repository = new FakeWalletRepository(wallet, {
      entries: [
        ledgerEntry('550e8400-e29b-41d4-a716-446655440010', '2026-09-05T12:00:00.000Z'),
      ],
      hasMore: true,
    });
    const useCase = new ListWalletLedgerUseCase(repository);

    const result = await useCase.execute(wallet.id, undefined, 1);

    expect(result.items).toEqual([{
      id: '550e8400-e29b-41d4-a716-446655440010',
      transactionId: '550e8400-e29b-41d4-a716-446655440011',
      direction: 'DEBIT',
      money: { amount: '25.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '75.00', currency: 'BRL' },
      createdAt: '2026-09-05T12:00:00.000Z',
    }]);
    expect(result.nextCursor).toBeString();
    expect(result.limit).toBe(1);
  });

  test('decodes the cursor before querying the next page', async () => {
    const repository = new FakeWalletRepository(wallet, { entries: [], hasMore: false });
    const useCase = new ListWalletLedgerUseCase(repository);
    const cursor = Buffer.from(JSON.stringify({
      createdAt: '2026-09-05T12:00:00.000Z',
      id: '550e8400-e29b-41d4-a716-446655440010',
    })).toString('base64url');

    await useCase.execute(wallet.id, cursor, 50);

    expect(repository.receivedCursor).toEqual({
      createdAt: new Date('2026-09-05T12:00:00.000Z'),
      id: '550e8400-e29b-41d4-a716-446655440010',
    });
  });

  test('rejects an invalid cursor without querying the ledger', async () => {
    const repository = new FakeWalletRepository(wallet, { entries: [], hasMore: false });
    const useCase = new ListWalletLedgerUseCase(repository);

    await expect(useCase.execute(wallet.id, 'not-a-valid-cursor', 50)).rejects.toThrow('O cursor do ledger é inválido.');
    expect(repository.wasLedgerQueried).toBe(false);
  });
});

class FakeWalletRepository implements WalletRepository {
  public receivedCursor: WalletLedgerCursor | undefined;
  public wasLedgerQueried = false;

  public constructor(
    private readonly wallet: WalletSnapshot,
    private readonly page: WalletLedgerPage,
  ) {}

  public async findById(): Promise<WalletSnapshot> {
    return this.wallet;
  }

  public async findMany(): Promise<WalletSnapshot[]> {
    return [];
  }

  public async reconcile(): Promise<undefined> {
    return undefined;
  }

  public async findLedgerPage(
    _walletId: string,
    cursor: WalletLedgerCursor | undefined,
  ): Promise<WalletLedgerPage> {
    this.wasLedgerQueried = true;
    this.receivedCursor = cursor;
    return this.page;
  }
}

function ledgerEntry(id: string, createdAt: string) {
  return {
    id,
    transactionId: '550e8400-e29b-41d4-a716-446655440011',
    direction: 'DEBIT' as const,
    amount: '25.00',
    currency: 'BRL',
    balanceBefore: '100.00',
    balanceAfter: '75.00',
    createdAt: new Date(createdAt),
  };
}
