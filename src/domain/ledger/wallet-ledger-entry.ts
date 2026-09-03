import { type Money } from '../money/money';
import { type LedgerDirection } from '../wallet/wallet';

export interface CreateWalletLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export type WalletLedgerEntryState = CreateWalletLedgerEntryProps;

export class InvalidLedgerEntryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidLedgerEntryError';
  }
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  public static create(props: CreateWalletLedgerEntryProps): WalletLedgerEntry {
    const entry = WalletLedgerEntry.fromProps(props);
    entry.assertValid();
    return entry;
  }

  public static rehydrate(state: WalletLedgerEntryState): WalletLedgerEntry {
    return WalletLedgerEntry.fromProps(state);
  }

  public isBalanced(): boolean {
    const expectedBalance =
      this.direction === 'CREDIT'
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);

    return expectedBalance.equals(this.balanceAfter);
  }

  private static fromProps(props: CreateWalletLedgerEntryProps): WalletLedgerEntry {
    return new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt,
    );
  }

  private assertValid(): void {
    this.assertSameCurrency();

    if (!this.money.isPositive()) {
      throw new InvalidLedgerEntryError('Ledger entries must have a positive amount.');
    }

    if (this.balanceBefore.isNegative() || this.balanceAfter.isNegative()) {
      throw new InvalidLedgerEntryError('Ledger balances cannot be negative.');
    }

    if (!this.isBalanced()) {
      throw new InvalidLedgerEntryError('Ledger entry balances do not match the movement.');
    }
  }

  private assertSameCurrency(): void {
    const currencies = [this.money.currency, this.balanceBefore.currency, this.balanceAfter.currency];

    if (new Set(currencies).size !== 1) {
      throw new InvalidLedgerEntryError('Ledger entry amounts must use the same currency.');
    }
  }
}
