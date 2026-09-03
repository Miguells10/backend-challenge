import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Distributed Wagering Processor')
    .setDescription('API for reliable wagering transaction processing.')
    .setVersion('1.0.0')
    .build();
  const swaggerDocumentFactory = (): ReturnType<typeof SwaggerModule.createDocument> =>
    SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocumentFactory, { jsonDocumentUrl: 'docs-json' });

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
