import { describe, expect, test } from 'bun:test';

import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction';
import { MetricsService } from '../../../src/observability/metrics.service';

describe('MetricsService', () => {
  test('renders every required business metric in Prometheus format', async () => {
    const metrics = new MetricsService();

    metrics.recordTransaction(WagerTransactionStatus.Processed, 'http');
    metrics.recordDuplicate('sqs');
    metrics.recordRetry('outbox');
    metrics.recordDeadLetter('invalid_message');
    metrics.setDeadLetterQueueSize(3);
    metrics.recordLockConflict('wallet');
    metrics.observeProcessingLatency('http', 0.025);
    metrics.setOutboxLag(2.5);
    metrics.recordReconciliationDivergence();

    const output = await metrics.render();

    expect(output).toContain('wagering_transactions_total');
    expect(output).toContain('wagering_idempotency_duplicates_total');
    expect(output).toContain('wagering_retries_total');
    expect(output).toContain('wagering_dlq_messages_total');
    expect(output).toMatch(/wagering_dlq_messages\{[^}]+\} 3/);
    expect(output).toContain('wagering_lock_conflicts_total');
    expect(output).toContain('wagering_processing_duration_seconds_count');
    expect(output).toContain('wagering_outbox_lag_seconds');
    expect(output).toContain('wagering_reconciliation_divergences_total');
    expect(output).not.toContain('amount');
    expect(output).not.toContain('balance');
  });
});
