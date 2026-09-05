import { Global, Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { StructuredLogger } from './structured-logger.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, StructuredLogger],
  exports: [MetricsService, StructuredLogger],
})
export class ObservabilityModule {}
