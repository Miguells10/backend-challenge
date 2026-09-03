import { Inject, Injectable } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';

import { SQS_CLIENT } from '../sqs/sqs.constants';

@Injectable()
export class HealthService {
  public constructor(
    private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqsClient: SQSClient,
  ) {}

  public async assertReady(): Promise<void> {
    await Promise.all([this.checkDatabase(), this.checkQueue()]);
  }

  private async checkDatabase(): Promise<void> {
    await this.orm.em.getConnection().execute('select 1');
  }

  private async checkQueue(): Promise<void> {
    const queueUrl = requiredEnvironment('WAGER_TRANSACTIONS_QUEUE_URL');
    await this.sqsClient.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }));
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}
