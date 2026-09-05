import { type EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { ProcessWagerTransactionUseCase } from '../application/wagering/process-wager-transaction.use-case';
import {
  PENDING_REFERENCE_RETRY_POLICY,
  type PendingReferenceRetryPolicy,
} from '../config/pending-reference-retry-policy';
import { WagerTransactionStatus } from '../domain/wagering/wager-transaction';
import { MetricsService } from '../observability/metrics.service';
import { StructuredLogger } from '../observability/structured-logger.service';

interface PendingReferenceRow {
  id: string;
  referenceAttempts: number;
}

type ReprocessNextResult = 'none' | 'handled' | 'rescheduled';

@Injectable()
export class PendingReferenceReprocessor {
  public constructor(
    private readonly orm: MikroORM,
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    @Inject(PENDING_REFERENCE_RETRY_POLICY)
    private readonly retryPolicy: PendingReferenceRetryPolicy,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly logger?: StructuredLogger,
  ) {}

  public async reprocessDue(now: Date, limit = this.retryPolicy.batchSize): Promise<number> {
    let handled = 0;

    for (let index = 0; index < limit; index += 1) {
      const result = await this.reprocessNext(now);
      if (result === 'none') {
        break;
      }
      handled += 1;
      if (result === 'rescheduled') {
        break;
      }
    }

    return handled;
  }

  private async reprocessNext(now: Date): Promise<ReprocessNextResult> {
    return this.orm.em.fork().transactional((em) => this.reprocessLockedTransaction(em, now), { clear: true });
  }

  private async reprocessLockedTransaction(em: EntityManager, now: Date): Promise<ReprocessNextResult> {
    const pending = await this.lockNextPendingReference(em, now);
    if (pending === undefined) {
      return 'none';
    }

    const resolved = await this.processWagerTransaction.reprocessPendingReferenceInTransaction(em, pending.id, now);
    if (resolved) {
      this.logger?.info('pending_reference_handled', {
        correlationId: pending.id,
        transactionId: pending.id,
      });
      return 'handled';
    }

    const attempts = pending.referenceAttempts + 1;
    if (attempts >= this.retryPolicy.maxAttempts) {
      await this.processWagerTransaction.rejectPendingReferenceInTransaction(em, pending.id, attempts);
      this.metrics?.recordTransaction(WagerTransactionStatus.Rejected, 'pending-reference');
      this.logger?.warn('pending_reference_exhausted', {
        correlationId: pending.id,
        transactionId: pending.id,
        attempt: attempts,
      });
      return 'handled';
    }

    await em.getConnection().execute(
      `
        update "wager_transactions"
        set "reference_attempts" = ?, "next_reference_attempt_at" = ?
        where "id" = ?
      `,
      [attempts, this.nextRetryAt(now, attempts), pending.id],
      'run',
      em.getTransactionContext(),
    );
    this.metrics?.recordRetry('pending-reference');
    this.logger?.warn('pending_reference_retry_scheduled', {
      correlationId: pending.id,
      transactionId: pending.id,
      attempt: attempts,
    });
    return 'rescheduled';
  }

  private async lockNextPendingReference(
    em: EntityManager,
    now: Date,
  ): Promise<PendingReferenceRow | undefined> {
    const rows = await em.getConnection().execute<PendingReferenceRow[]>(`
      select "id", "reference_attempts" as "referenceAttempts"
      from "wager_transactions"
      where "status" = 'PENDING_REFERENCE'
        and ("next_reference_attempt_at" is null or "next_reference_attempt_at" <= ?)
      order by "next_reference_attempt_at" nulls first, "created_at", "id"
      limit 1
      for update skip locked
    `, [now], 'all', em.getTransactionContext());
    return rows[0];
  }

  private nextRetryAt(now: Date, attempts: number): Date {
    const delay = Math.min(
      this.retryPolicy.initialDelayMs * 2 ** (attempts - 1),
      this.retryPolicy.maxDelayMs,
    );
    return new Date(now.getTime() + delay);
  }
}
