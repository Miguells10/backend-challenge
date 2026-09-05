import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

import { type WagerTransactionStatus } from '../domain/wagering/wager-transaction';

type TransactionSource = 'http' | 'pending-reference' | 'sqs';
type RetryComponent = 'outbox' | 'pending-reference' | 'sqs';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly transactions: Counter<'source' | 'status'>;
  private readonly duplicates: Counter<'source'>;
  private readonly retries: Counter<'component'>;
  private readonly deadLetters: Counter<'reason'>;
  private readonly deadLetterQueueSize: Gauge;
  private readonly lockConflicts: Counter<'operation'>;
  private readonly processingLatency: Histogram<'source'>;
  private readonly outboxLag: Gauge;
  private readonly reconciliationDivergences: Counter;

  public constructor() {
    this.registry.setDefaultLabels({
      service: process.env.SERVICE_NAME ?? 'api',
      instance: process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? `pid-${process.pid}`,
    });
    collectDefaultMetrics({ prefix: 'wagering_process_', register: this.registry });

    this.transactions = new Counter({
      name: 'wagering_transactions_total',
      help: 'Number of new wagering transaction results observed by status and entry point.',
      labelNames: ['status', 'source'],
      registers: [this.registry],
    });
    this.duplicates = new Counter({
      name: 'wagering_idempotency_duplicates_total',
      help: 'Number of safe duplicate requests or messages detected.',
      labelNames: ['source'],
      registers: [this.registry],
    });
    this.retries = new Counter({
      name: 'wagering_retries_total',
      help: 'Number of retries observed by component.',
      labelNames: ['component'],
      registers: [this.registry],
    });
    this.deadLetters = new Counter({
      name: 'wagering_dlq_messages_total',
      help: 'Number of messages moved to a dead-letter queue.',
      labelNames: ['reason'],
      registers: [this.registry],
    });
    this.deadLetterQueueSize = new Gauge({
      name: 'wagering_dlq_messages',
      help: 'Approximate number of currently visible messages in the dead-letter queue.',
      registers: [this.registry],
    });
    this.lockConflicts = new Counter({
      name: 'wagering_lock_conflicts_total',
      help: 'Number of database lock conflicts by operation.',
      labelNames: ['operation'],
      registers: [this.registry],
    });
    this.processingLatency = new Histogram({
      name: 'wagering_processing_duration_seconds',
      help: 'Wager transaction processing latency in seconds.',
      labelNames: ['source'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.outboxLag = new Gauge({
      name: 'wagering_outbox_lag_seconds',
      help: 'Age in seconds of the oldest unpublished outbox message.',
      registers: [this.registry],
    });
    this.reconciliationDivergences = new Counter({
      name: 'wagering_reconciliation_divergences_total',
      help: 'Number of wallet reconciliation divergences detected.',
      registers: [this.registry],
    });
  }

  public recordTransaction(status: WagerTransactionStatus, source: TransactionSource): void {
    this.transactions.inc({ status, source });
  }

  public recordDuplicate(source: 'http' | 'sqs'): void {
    this.duplicates.inc({ source });
  }

  public recordRetry(component: RetryComponent): void {
    this.retries.inc({ component });
  }

  public recordDeadLetter(reason: string): void {
    this.deadLetters.inc({ reason });
  }

  public setDeadLetterQueueSize(size: number): void {
    this.deadLetterQueueSize.set(Math.max(0, size));
  }

  public recordLockConflict(operation: string): void {
    this.lockConflicts.inc({ operation });
  }

  public observeProcessingLatency(source: TransactionSource, seconds: number): void {
    this.processingLatency.observe({ source }, seconds);
  }

  public setOutboxLag(seconds: number): void {
    this.outboxLag.set(Math.max(0, seconds));
  }

  public recordReconciliationDivergence(): void {
    this.reconciliationDivergences.inc();
  }

  public render(): Promise<string> {
    return this.registry.metrics();
  }

  public get contentType(): string {
    return this.registry.contentType;
  }
}
