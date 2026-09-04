import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../src/app.module';

const describeIntegration = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeIntegration('HTTP API', () => {
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let orm: MikroORM;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    orm = app.get(MikroORM);
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (address === null || typeof address === 'string') throw new Error('HTTP server address is unavailable.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await orm.em.fork().getConnection().execute('truncate table outbox_messages, inbox_messages, wallet_ledger_entries, wager_transactions, wallets cascade');
  });

  afterAll(async () => app.close());

  test('creates a wallet, submits an idempotent bet, and exposes both resources', async () => {
    const playerId = crypto.randomUUID();
    const wallet = await json(await fetch(`${baseUrl}/wallets`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    }));

    expect(wallet.response.status).toBe(201);
    expect(wallet.body.balance.amount).toBe('100.00');

    const request = {
      providerId: 'provider-http', externalTransactionId: 'bet-http-1', playerId,
      walletId: wallet.body.id, roundId: 'round-http', gameId: 'game-http', kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };
    const wager = await json(await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:bet-http-1' },
      body: JSON.stringify(request),
    }));
    const replay = await json(await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:bet-http-1' },
      body: JSON.stringify(request),
    }));
    const walletRead = await json(await fetch(`${baseUrl}/wallets/${wallet.body.id}`));
    const transactionRead = await json(await fetch(`${baseUrl}/wagering/transactions/${wager.body.transactionId}`));
    const externalRead = await json(await fetch(`${baseUrl}/providers/provider-http/wagering/transactions/bet-http-1`));

    expect(wager.response.status).toBe(200);
    expect(wager.body.balance.amount).toBe('75.00');
    expect(replay.body.idempotentReplay).toBe(true);
    expect(walletRead.body.balance.amount).toBe('75.00');
    expect(transactionRead.body.externalTransactionId).toBe('bet-http-1');
    expect(externalRead.body.id).toBe(wager.body.transactionId);
  });
});

async function json(response: Response) {
  return { response, body: await response.json() as ApiResponse };
}

interface ApiResponse {
  id: string;
  balance: { amount: string; currency: string };
  transactionId: string;
  idempotentReplay: boolean;
  externalTransactionId: string;
}
