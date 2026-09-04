import { Migration } from '@mikro-orm/migrations';

export class Migration2026090319000 extends Migration {
  public override up(): void {
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" uuid not null,
        "currency" char(3) not null,
        "balance_amount" numeric(18,2) not null,
        "version" integer not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallets_pkey" primary key ("id"),
        constraint "wallets_player_id_currency_unique" unique ("player_id", "currency"),
        constraint "wallets_id_currency_unique" unique ("id", "currency"),
        constraint "wallets_id_player_id_currency_unique" unique ("id", "player_id", "currency"),
        constraint "wallets_currency_check" check ("currency" ~ '^[A-Z]{3}$'),
        constraint "wallets_balance_non_negative_check" check ("balance_amount" >= 0),
        constraint "wallets_version_positive_check" check ("version" >= 1)
      );

      create table "wager_transactions" (
        "id" uuid not null,
        "provider_id" varchar(128) not null,
        "external_transaction_id" varchar(255) not null,
        "idempotency_key" varchar(512) not null,
        "payload_hash" varchar(128) not null,
        "wallet_id" uuid not null,
        "player_id" uuid not null,
        "round_id" varchar(255) not null,
        "game_id" varchar(255) not null,
        "kind" varchar(16) not null,
        "amount" numeric(18,2) not null,
        "currency" char(3) not null,
        "reference_external_transaction_id" varchar(255) null,
        "reference_transaction_id" uuid null,
        "status" varchar(20) not null,
        "failure_code" varchar(64) null,
        "result_balance_amount" numeric(18,2) null,
        "created_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "wager_transactions_pkey" primary key ("id"),
        constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key"),
        constraint "wager_transactions_provider_external_id_unique" unique ("provider_id", "external_transaction_id"),
        constraint "wager_transactions_id_wallet_currency_unique" unique ("id", "wallet_id", "currency"),
        constraint "wager_transactions_wallet_context_foreign" foreign key ("wallet_id", "player_id", "currency") references "wallets" ("id", "player_id", "currency"),
        constraint "wager_transactions_reference_foreign" foreign key ("reference_transaction_id") references "wager_transactions" ("id"),
        constraint "wager_transactions_currency_check" check ("currency" ~ '^[A-Z]{3}$'),
        constraint "wager_transactions_amount_positive_check" check ("amount" > 0),
        constraint "wager_transactions_kind_check" check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        constraint "wager_transactions_failure_code_check" check ("failure_code" is null or "failure_code" in ('INSUFFICIENT_FUNDS', 'REFERENCE_NOT_FOUND', 'INVALID_REFERENCE', 'ROLLBACK_WOULD_OVERDRAW')),
        constraint "wager_transactions_result_balance_non_negative_check" check ("result_balance_amount" is null or "result_balance_amount" >= 0)
      );

      create index "wager_transactions_wallet_created_at_index" on "wager_transactions" ("wallet_id", "created_at");
      create index "wager_transactions_provider_reference_external_id_index" on "wager_transactions" ("provider_id", "reference_external_transaction_id");

      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar(6) not null,
        "amount" numeric(18,2) not null,
        "currency" char(3) not null,
        "balance_before" numeric(18,2) not null,
        "balance_after" numeric(18,2) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entries_pkey" primary key ("id"),
        constraint "wallet_ledger_entries_transaction_id_unique" unique ("transaction_id"),
        constraint "wallet_ledger_entries_wallet_currency_foreign" foreign key ("wallet_id", "currency") references "wallets" ("id", "currency"),
        constraint "wallet_ledger_entries_transaction_context_foreign" foreign key ("transaction_id", "wallet_id", "currency") references "wager_transactions" ("id", "wallet_id", "currency"),
        constraint "wallet_ledger_entries_currency_check" check ("currency" ~ '^[A-Z]{3}$'),
        constraint "wallet_ledger_entries_direction_check" check ("direction" in ('CREDIT', 'DEBIT')),
        constraint "wallet_ledger_entries_amount_positive_check" check ("amount" > 0),
        constraint "wallet_ledger_entries_balance_non_negative_check" check ("balance_before" >= 0 and "balance_after" >= 0),
        constraint "wallet_ledger_entries_arithmetic_check" check (
          ("direction" = 'CREDIT' and "balance_after" = "balance_before" + "amount") or
          ("direction" = 'DEBIT' and "balance_after" = "balance_before" - "amount")
        )
      );

      create index "wallet_ledger_entries_wallet_cursor_index" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");

      create function "prevent_wallet_ledger_entry_mutation"() returns trigger as $$
      begin
        raise exception 'wallet ledger entries are immutable';
      end;
      $$ language plpgsql;

      create trigger "wallet_ledger_entries_prevent_update" before update on "wallet_ledger_entries"
        for each row execute function "prevent_wallet_ledger_entry_mutation"();
      create trigger "wallet_ledger_entries_prevent_delete" before delete on "wallet_ledger_entries"
        for each row execute function "prevent_wallet_ledger_entry_mutation"();

      create function "validate_wallet_ledger_entry_transaction"() returns trigger as $$
      declare
        transaction_kind varchar(16);
        transaction_status varchar(20);
      begin
        select "kind", "status" into transaction_kind, transaction_status
        from "wager_transactions"
        where "id" = new."transaction_id";

        if transaction_status <> 'PROCESSED' or transaction_kind = 'LOSS' then
          raise exception 'ledger entry requires a processed balance-affecting transaction';
        end if;

        if transaction_kind = 'BET' and new."direction" <> 'DEBIT' then
          raise exception 'bet ledger entries must be debits';
        end if;

        if transaction_kind in ('OPENING', 'WIN', 'REFUND') and new."direction" <> 'CREDIT' then
          raise exception 'opening, win, and refund ledger entries must be credits';
        end if;

        return new;
      end;
      $$ language plpgsql;

      create trigger "wallet_ledger_entries_validate_transaction" before insert on "wallet_ledger_entries"
        for each row execute function "validate_wallet_ledger_entry_transaction"();
    `);
  }

  public override down(): void {
    this.addSql(`
      drop table if exists "wallet_ledger_entries";
      drop table if exists "wager_transactions";
      drop table if exists "wallets";
      drop function if exists "validate_wallet_ledger_entry_transaction"();
      drop function if exists "prevent_wallet_ledger_entry_mutation"();
    `);
  }
}
