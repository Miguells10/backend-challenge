import { Module } from '@nestjs/common';

import { ProcessWagerTransactionUseCase } from '../application/wagering/process-wager-transaction.use-case';
import { SqsModule } from '../sqs/sqs.module';
import { OutboxPublisher } from '../sqs/outbox-publisher';
import { WagerTransactionSqsConsumer } from '../sqs/wager-transaction-sqs-consumer';

@Module({
  imports: [SqsModule],
  providers: [ProcessWagerTransactionUseCase, WagerTransactionSqsConsumer, OutboxPublisher],
  exports: [ProcessWagerTransactionUseCase, WagerTransactionSqsConsumer, OutboxPublisher],
})
export class WageringModule {}
