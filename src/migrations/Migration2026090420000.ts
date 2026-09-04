import { Migration } from '@mikro-orm/migrations';

export class Migration2026090420000 extends Migration {
  public override up(): void {
    this.addSql(`
      alter table "wager_transactions"
        add column "reference_attempts" integer not null default 0,
        add column "next_reference_attempt_at" timestamptz null,
        add constraint "wager_transactions_reference_attempts_non_negative_check" check ("reference_attempts" >= 0);

      create index "wager_transactions_pending_reference_cursor_index"
        on "wager_transactions" ("status", "next_reference_attempt_at")
        where "status" = 'PENDING_REFERENCE';
    `);
  }

  public override down(): void {
    this.addSql(`
      drop index if exists "wager_transactions_pending_reference_cursor_index";
      alter table "wager_transactions"
        drop constraint if exists "wager_transactions_reference_attempts_non_negative_check",
        drop column if exists "next_reference_attempt_at",
        drop column if exists "reference_attempts";
    `);
  }
}
