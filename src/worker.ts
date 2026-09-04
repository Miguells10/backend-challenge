import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { WagerTransactionSqsConsumer } from './sqs/wager-transaction-sqs-consumer';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const consumer = app.get(WagerTransactionSqsConsumer);
  let stopping = false;
  const stop = (): void => {
    stopping = true;
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopping) {
    try {
      await consumer.pollOnce();
    } catch (error) {
      console.error(JSON.stringify({ event: 'wager_consumer_error', message: errorMessage(error) }));
      await delay(1_000);
    }
  }

  await app.close();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown consumer error.';
}

void bootstrap();
