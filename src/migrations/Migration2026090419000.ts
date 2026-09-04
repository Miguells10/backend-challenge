import { Migration } from '@mikro-orm/migrations';

export class Migration2026090419000 extends Migration {
  public override up(): void {
    this.addSql(`
      create table "inbox_messages" (
        "id" uuid not null,
        "message_id" varchar(255) not null,
        "consumer_name" varchar(128) not null,
        "payload_hash" varchar(128) not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey" primary key ("id"),
        constraint "inbox_messages_consumer_message_unique" unique ("consumer_name", "message_id")
      );

      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" uuid not null,
        "event_type" varchar(128) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_messages_pkey" primary key ("id"),
        constraint "outbox_messages_attempts_non_negative_check" check ("attempts" >= 0),
        constraint "outbox_messages_published_retry_check" check ("published_at" is null or "next_attempt_at" is null)
      );

      create index "outbox_messages_pending_cursor_index"
        on "outbox_messages" ("published_at", "next_attempt_at", "occurred_at");
    `);
  }

  public override down(): void {
    this.addSql(`
      drop table if exists "outbox_messages";
      drop table if exists "inbox_messages";
    `);
  }
}
