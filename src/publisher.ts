import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { OutboxPublisher } from './sqs/outbox-publisher';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const publisher = app.get(OutboxPublisher);
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
      console.error(JSON.stringify({ event: 'outbox_publisher_error', message: errorMessage(error) }));
      await delay(1_000);
    }
  }

  await app.close();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown publisher error.';
}

void bootstrap();
