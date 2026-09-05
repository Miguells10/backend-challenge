import 'reflect-metadata';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';

export async function createApplication(): Promise<INestApplication> {
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

  return app;
}
