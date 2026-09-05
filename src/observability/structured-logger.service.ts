import { Injectable } from '@nestjs/common';

export interface StructuredLogContext {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
  [key: string]: boolean | number | string | undefined;
}

@Injectable()
export class StructuredLogger {
  private readonly service = process.env.SERVICE_NAME ?? 'api';
  private readonly instanceId = process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? `pid-${process.pid}`;

  public info(event: string, context: StructuredLogContext = {}): void {
    this.write('info', event, context);
  }

  public warn(event: string, context: StructuredLogContext = {}): void {
    this.write('warn', event, context);
  }

  public error(event: string, context: StructuredLogContext = {}): void {
    this.write('error', event, context);
  }

  private write(level: 'error' | 'info' | 'warn', event: string, context: StructuredLogContext): void {
    const entry = Object.fromEntries(
      Object.entries({
        timestamp: new Date().toISOString(),
        level,
        service: this.service,
        instanceId: this.instanceId,
        event,
        ...context,
      }).filter(([, value]) => value !== undefined),
    );
    const line = `${JSON.stringify(entry)}\n`;
    if (level === 'error') {
      process.stderr.write(line);
      return;
    }
    process.stdout.write(line);
  }
}
