import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import {
  PENDING_REFERENCE_RETRY_POLICY,
  type PendingReferenceRetryPolicy,
} from './config/pending-reference-retry-policy';
import { MetricsService } from './observability/metrics.service';
import { startMetricsServer } from './observability/metrics-server';
import { StructuredLogger } from './observability/structured-logger.service';
import { PendingReferenceReprocessor } from './wagering/pending-reference-reprocessor';

async function bootstrap(): Promise<void> {
  process.env.SERVICE_NAME ??= 'reference-reprocessor';
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
    logger: new ConsoleLogger({ json: true }),
  });
  const reprocessor = app.get(PendingReferenceReprocessor);
  const retryPolicy = app.get<PendingReferenceRetryPolicy>(PENDING_REFERENCE_RETRY_POLICY);
  const metrics = app.get(MetricsService);
  const logger = app.get(StructuredLogger);
  const metricsServer = startMetricsServer(metrics, logger);
  let stopping = false;
  const stop = (): void => {
    stopping = true;
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopping) {
    try {
      const handled = await reprocessor.reprocessDue(new Date());
      if (handled === 0) {
        await delay(retryPolicy.pollIntervalMs);
      }
    } catch (error) {
      metrics.recordRetry('pending-reference');
      logger.error('pending_reference_reprocessor_error', { errorType: errorName(error) });
      await delay(retryPolicy.pollIntervalMs);
    }
  }

  await metricsServer.stop();
  await app.close();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

void bootstrap();
