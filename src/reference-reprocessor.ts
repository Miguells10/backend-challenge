import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import {
  PENDING_REFERENCE_RETRY_POLICY,
  type PendingReferenceRetryPolicy,
} from './config/pending-reference-retry-policy';
import { PendingReferenceReprocessor } from './wagering/pending-reference-reprocessor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const reprocessor = app.get(PendingReferenceReprocessor);
  const retryPolicy = app.get<PendingReferenceRetryPolicy>(PENDING_REFERENCE_RETRY_POLICY);
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
      console.error(JSON.stringify({ event: 'pending_reference_reprocessor_error', message: errorMessage(error) }));
      await delay(retryPolicy.pollIntervalMs);
    }
  }

  await app.close();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown pending-reference reprocessor error.';
}

void bootstrap();
