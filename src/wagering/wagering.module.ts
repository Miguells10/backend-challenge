import { Module } from '@nestjs/common';

import { ProcessWagerTransactionUseCase } from '../application/wagering/process-wager-transaction.use-case';
import { SqsModule } from '../sqs/sqs.module';
import { WagerTransactionSqsConsumer } from '../sqs/wager-transaction-sqs-consumer';

@Module({
  imports: [SqsModule],
  providers: [ProcessWagerTransactionUseCase, WagerTransactionSqsConsumer],
  exports: [ProcessWagerTransactionUseCase, WagerTransactionSqsConsumer],
})
export class WageringModule {}
