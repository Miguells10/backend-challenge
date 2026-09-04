import { Module } from '@nestjs/common';

import { ProcessWagerTransactionUseCase } from '../application/wagering/process-wager-transaction.use-case';
import {
  PENDING_REFERENCE_RETRY_POLICY,
  pendingReferenceRetryPolicyFromEnvironment,
} from '../config/pending-reference-retry-policy';
import { SqsModule } from '../sqs/sqs.module';
import { OutboxPublisher } from '../sqs/outbox-publisher';
import { PendingReferenceReprocessor } from './pending-reference-reprocessor';
import { WagerTransactionSqsConsumer } from '../sqs/wager-transaction-sqs-consumer';

@Module({
  imports: [SqsModule],
  providers: [
    {
      provide: PENDING_REFERENCE_RETRY_POLICY,
      useFactory: pendingReferenceRetryPolicyFromEnvironment,
    },
    ProcessWagerTransactionUseCase,
    WagerTransactionSqsConsumer,
    OutboxPublisher,
    PendingReferenceReprocessor,
  ],
  exports: [ProcessWagerTransactionUseCase, WagerTransactionSqsConsumer, OutboxPublisher, PendingReferenceReprocessor],
})
export class WageringModule {}
