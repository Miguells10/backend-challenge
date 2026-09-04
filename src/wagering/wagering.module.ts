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
import { MikroOrmWagerTransactionRepository } from '../infrastructure/persistence/repositories/mikro-orm-wager-transaction.repository';
import { WageringController } from './wagering.controller';
import { GetWagerTransactionUseCase } from './get-wager-transaction.use-case';
import { WAGER_TRANSACTION_REPOSITORY } from './wager-transaction.repository';

@Module({
  imports: [SqsModule],
  controllers: [WageringController],
  providers: [
    {
      provide: PENDING_REFERENCE_RETRY_POLICY,
      useFactory: pendingReferenceRetryPolicyFromEnvironment,
    },
    ProcessWagerTransactionUseCase,
    GetWagerTransactionUseCase,
    MikroOrmWagerTransactionRepository,
    { provide: WAGER_TRANSACTION_REPOSITORY, useExisting: MikroOrmWagerTransactionRepository },
    WagerTransactionSqsConsumer,
    OutboxPublisher,
    PendingReferenceReprocessor,
  ],
  exports: [ProcessWagerTransactionUseCase, WagerTransactionSqsConsumer, OutboxPublisher, PendingReferenceReprocessor],
})
export class WageringModule {}
