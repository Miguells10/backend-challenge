import { type Money, MoneyValidationError } from '../money/money';

export type LedgerDirection = 'CREDIT' | 'DEBIT';

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  createdAt?: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletBalanceChange {
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  walletVersion: number;
}

export class InsufficientFundsError extends Error {
  public constructor() {
    super('The wallet does not have enough funds for this debit.');
    this.name = 'InsufficientFundsError';
  }
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  public static open(props: OpenWalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new MoneyValidationError('Initial wallet balance cannot be negative.');
    }

    const createdAt = props.createdAt ?? new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      createdAt,
      createdAt,
    );
  }

  public static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public credit(money: Money, at: Date): WalletBalanceChange {
    return this.applyChange('CREDIT', money, at);
  }

  public debit(money: Money, at: Date): WalletBalanceChange {
    return this.applyChange('DEBIT', money, at);
  }

  private applyChange(direction: LedgerDirection, money: Money, at: Date): WalletBalanceChange {
    this.assertSameCurrency(money);
    this.assertNonZeroMovement(money);

    const balanceBefore = this._balance;
    const balanceAfter = direction === 'CREDIT' ? balanceBefore.add(money) : balanceBefore.subtract(money);
    this.assertNonNegativeBalance(balanceAfter);

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = at;

    return { direction, money, balanceBefore, balanceAfter, walletVersion: this._version };
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new MoneyValidationError(`Wallet currency ${this.currency} does not match ${money.currency}.`);
    }
  }

  private assertNonZeroMovement(money: Money): void {
    if (money.isZero()) {
      throw new MoneyValidationError('Wallet movements must have a non-zero amount.');
    }
  }

  private assertNonNegativeBalance(balance: Money): void {
    if (balance.isNegative()) {
      throw new InsufficientFundsError();
    }
  }
}
