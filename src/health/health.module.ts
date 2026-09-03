import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { SqsModule } from '../sqs/sqs.module';

@Module({
  imports: [SqsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
