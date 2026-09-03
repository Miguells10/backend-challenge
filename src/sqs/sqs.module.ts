import { Module } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';

import { SQS_CLIENT } from './sqs.constants';

@Module({
  providers: [
    {
      provide: SQS_CLIENT,
      useFactory: (): SQSClient =>
        new SQSClient({
          endpoint: requiredEnvironment('SQS_ENDPOINT'),
          region: requiredEnvironment('AWS_REGION'),
          credentials: {
            accessKeyId: requiredEnvironment('AWS_ACCESS_KEY_ID'),
            secretAccessKey: requiredEnvironment('AWS_SECRET_ACCESS_KEY'),
          },
        }),
    },
  ],
  exports: [SQS_CLIENT],
})
export class SqsModule {}

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}
