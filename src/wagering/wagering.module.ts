import { Module } from '@nestjs/common';

import { ProcessWagerTransactionUseCase } from '../application/wagering/process-wager-transaction.use-case';
import { PROVIDER_IDENTITY_PORT } from '../application/identity/provider-identity.port';
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
import { NoOpProviderIdentityAdapter } from '../infrastructure/identity/no-op-provider-identity.adapter';

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
    NoOpProviderIdentityAdapter,
    { provide: PROVIDER_IDENTITY_PORT, useExisting: NoOpProviderIdentityAdapter },
    MikroOrmWagerTransactionRepository,
    { provide: WAGER_TRANSACTION_REPOSITORY, useExisting: MikroOrmWagerTransactionRepository },
    WagerTransactionSqsConsumer,
    OutboxPublisher,
    PendingReferenceReprocessor,
  ],
  exports: [ProcessWagerTransactionUseCase, WagerTransactionSqsConsumer, OutboxPublisher, PendingReferenceReprocessor],
})
export class WageringModule {}
