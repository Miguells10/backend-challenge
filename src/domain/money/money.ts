import Decimal from 'decimal.js';

const AMOUNT_PATTERN = /^\d+\.\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class MoneyValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MoneyValidationError';
  }
}

export class CurrencyMismatchError extends Error {
  public constructor(expected: string, received: string) {
    super(`Expected currency ${expected}, received ${received}.`);
    this.name = 'CurrencyMismatchError';
  }
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  public static from(props: MoneyProps): Money {
    const currency = validateCurrency(props.currency);
    const amount = validateExternalAmount(props.amount);

    return Money.fromDecimal(amount, currency);
  }

  public static zero(currency: string): Money {
    return Money.fromDecimal(new Decimal(0), validateCurrency(currency));
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromDecimal(this.value.plus(other.value), this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromDecimal(this.value.minus(other.value), this.currency);
  }

  public negate(): Money {
    return Money.fromDecimal(this.value.negated(), this.currency);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  public isNegative(): boolean {
    return this.value.isNegative();
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  public equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  public toJSON(): MoneyProps {
    return { amount: this.value.toFixed(2), currency: this.currency };
  }

  public toString(): string {
    const { amount, currency } = this.toJSON();
    return `${amount} ${currency}`;
  }

  private static fromDecimal(value: Decimal, currency: string): Money {
    return new Money(value, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

function validateCurrency(currency: string): string {
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new MoneyValidationError('Currency must be a three-letter uppercase ISO-4217 code.');
  }

  return currency;
}

function validateExternalAmount(amount: string): Decimal {
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new MoneyValidationError('Amount must be a non-negative decimal string with exactly two decimal places.');
  }

  return new Decimal(amount);
}
