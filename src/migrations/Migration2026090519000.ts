import { Migration } from '@mikro-orm/migrations';

export class Migration2026090519000 extends Migration {
  public override up(): void {
    this.addSql(`
      alter table "wager_transactions"
        drop constraint "wager_transactions_failure_code_check",
        add constraint "wager_transactions_failure_code_check" check (
          "failure_code" is null or "failure_code" in (
            'INSUFFICIENT_FUNDS',
            'REFERENCE_NOT_FOUND',
            'INVALID_REFERENCE',
            'REVERSAL_ALREADY_PROCESSED',
            'ROLLBACK_WOULD_OVERDRAW'
          )
        );

      create unique index if not exists "wager_transactions_processed_reversal_once_per_kind_unique"
        on "wager_transactions" ("reference_transaction_id", "kind")
        where "status" = 'PROCESSED'
          and "kind" in ('REFUND', 'ROLLBACK');
    `);
  }

  public override down(): void {
    this.addSql(`
      drop index if exists "wager_transactions_processed_reversal_once_per_kind_unique";

      alter table "wager_transactions"
        drop constraint "wager_transactions_failure_code_check",
        add constraint "wager_transactions_failure_code_check" check (
          "failure_code" is null or "failure_code" in (
            'INSUFFICIENT_FUNDS',
            'REFERENCE_NOT_FOUND',
            'INVALID_REFERENCE',
            'ROLLBACK_WOULD_OVERDRAW'
          )
        );
    `);
  }
}
