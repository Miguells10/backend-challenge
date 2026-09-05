import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { MetricsService } from './observability/metrics.service';
import { startMetricsServer } from './observability/metrics-server';
import { StructuredLogger } from './observability/structured-logger.service';
import { OutboxPublisher } from './sqs/outbox-publisher';

async function bootstrap(): Promise<void> {
  process.env.SERVICE_NAME ??= 'publisher';
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
    logger: new ConsoleLogger({ json: true }),
  });
  const publisher = app.get(OutboxPublisher);
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
      const published = await publisher.publishDue();
      if (published === 0) {
        await delay(1_000);
      }
    } catch (error) {
      metrics.recordRetry('outbox');
      logger.error('outbox_publisher_error', { errorType: errorName(error) });
      await delay(1_000);
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
