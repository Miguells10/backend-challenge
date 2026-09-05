import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';

import { createApplication } from '../../src/app.factory';

const describeIntegration = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeIntegration('HTTP API', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let orm: MikroORM;
  let baseUrl: string;

  beforeAll(async () => {
    app = await createApplication();
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
    const wallets = await json<WalletListResponse>(await fetch(`${baseUrl}/wallets`));
    const oneWallet = await json<WalletListResponse>(await fetch(`${baseUrl}/wallets?limit=1`));
    const transactionRead = await json(await fetch(`${baseUrl}/wagering/transactions/${wager.body.transactionId}`));
    const externalRead = await json(await fetch(`${baseUrl}/providers/provider-http/wagering/transactions/bet-http-1`));
    const reconciliation = await json<WalletReconciliationResponse>(await fetch(`${baseUrl}/wallets/${wallet.body.id}/reconciliation`, {
      method: 'POST',
    }));
    const walletAfterReconciliation = await json(await fetch(`${baseUrl}/wallets/${wallet.body.id}`));

    expect(wager.response.status).toBe(200);
    expect(wager.body.balance.amount).toBe('75.00');
    expect(replay.body.idempotentReplay).toBe(true);
    expect(walletRead.body.balance.amount).toBe('75.00');
    expect(wallets.body.items.map((item) => item.id)).toContain(wallet.body.id);
    expect(oneWallet.body.limit).toBe(1);
    expect(oneWallet.body.items).toHaveLength(1);
    expect(transactionRead.body.externalTransactionId).toBe('bet-http-1');
    expect(externalRead.body.id).toBe(wager.body.transactionId);
    expect(reconciliation.response.status).toBe(200);
    expect(reconciliation.body).toEqual({
      walletId: wallet.body.id,
      storedBalance: { amount: '75.00', currency: 'BRL' },
      calculatedBalance: { amount: '75.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 2,
    });
    expect(walletAfterReconciliation.body).toEqual(walletRead.body);
  });

  test('returns a conflict when the player already has a wallet in that currency', async () => {
    const playerId = crypto.randomUUID();
    const request = JSON.stringify({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    const first = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: request,
    });
    const duplicate = await json<ApiError>(await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: request,
    }));

    expect(first.status).toBe(201);
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.statusCode).toBe(409);
  });

  test('returns bad request with readable validation messages and invalid transaction rules', async () => {
    const playerId = crypto.randomUUID();
    const wallet = await createWallet(baseUrl, playerId);

    const zeroValueBet = await json<ApiError>(await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:zero-value' },
      body: JSON.stringify(wagerRequest({ playerId, walletId: wallet.id, externalTransactionId: 'zero-value', amount: '0.00' })),
    }));
    const incompleteRefund = await json<ApiError>(await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:incomplete-refund' },
      body: JSON.stringify(wagerRequest({
        playerId,
        walletId: wallet.id,
        externalTransactionId: 'incomplete-refund',
        kind: 'REFUND',
      })),
    }));
    const openingTransaction = await json<ApiError>(await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:opening' },
      body: JSON.stringify(wagerRequest({
        playerId,
        walletId: wallet.id,
        externalTransactionId: 'opening',
        kind: 'OPENING',
      })),
    }));
    const invalidAmount = await json<ApiError>(await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:invalid-amount' },
      body: JSON.stringify(wagerRequest({ playerId, walletId: wallet.id, externalTransactionId: 'invalid-amount', amount: '1' })),
    }));
    const invalidCurrency = await json<ApiError>(await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:invalid-currency' },
      body: JSON.stringify({ ...wagerRequest({ playerId, walletId: wallet.id, externalTransactionId: 'invalid-currency' }), money: { amount: '1.00', currency: 'brl' } }),
    }));

    expect(zeroValueBet.response.status).toBe(400);
    expect(zeroValueBet.body.statusCode).toBe(400);
    expect(incompleteRefund.response.status).toBe(400);
    expect(incompleteRefund.body.statusCode).toBe(400);
    expect(openingTransaction.response.status).toBe(400);
    expect(openingTransaction.body.statusCode).toBe(400);
    expect(invalidAmount.body.message).toEqual(['money.amount deve ter duas casas decimais, por exemplo: 100.00.']);
    expect(invalidCurrency.body.message).toEqual(['money.currency deve ter exatamente três letras maiúsculas, por exemplo: BRL.']);
  });

  test('returns documented statuses for missing resources, idempotency conflict, and pending references', async () => {
    const missingWallet = await json<ApiError>(await fetch(`${baseUrl}/wallets/${crypto.randomUUID()}`));
    const missingTransaction = await json<ApiError>(await fetch(`${baseUrl}/wagering/transactions/${crypto.randomUUID()}`));
    const missingReconciliation = await json<ApiError>(await fetch(`${baseUrl}/wallets/${crypto.randomUUID()}/reconciliation`, { method: 'POST' }));
    const playerId = crypto.randomUUID();
    const wallet = await createWallet(baseUrl, playerId);
    const request = wagerRequest({ playerId, walletId: wallet.id, externalTransactionId: 'conflicting-bet' });

    const accepted = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:conflicting-bet' },
      body: JSON.stringify(request),
    });
    const conflict = await json<ApiError>(await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:conflicting-bet' },
      body: JSON.stringify({ ...request, money: { amount: '30.00', currency: 'BRL' } }),
    }));
    const pending = await json<PendingWagerResponse>(await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'provider-http:pending-refund' },
      body: JSON.stringify(wagerRequest({
        playerId,
        walletId: wallet.id,
        externalTransactionId: 'pending-refund',
        kind: 'REFUND',
        referenceExternalTransactionId: 'missing-bet',
      })),
    }));

    expect(missingWallet.response.status).toBe(404);
    expect(missingTransaction.response.status).toBe(404);
    expect(missingReconciliation.response.status).toBe(404);
    expect(accepted.status).toBe(200);
    expect(conflict.response.status).toBe(409);
    expect(pending.response.status).toBe(202);
    expect(pending.body.status).toBe('PENDING_REFERENCE');
  });

  test('publishes the HTTP error contract in Swagger', async () => {
    const swagger = await json<SwaggerDocument>(await fetch(`${baseUrl}/docs-json`));
    const walletResponses = swagger.body.paths['/wallets'].post.responses;
    const wageringResponses = swagger.body.paths['/wagering/transactions'].post.responses;
    const walletListParameter = swagger.body.paths['/wallets'].get.parameters[0];
    const idempotencyParameters = swagger.body.paths['/wagering/transactions'].post.parameters
      .filter((parameter) => parameter.name === 'idempotency-key');

    expect(swagger.response.status).toBe(200);
    expect(walletResponses['409']).toBeDefined();
    expect(wageringResponses['202']).toBeDefined();
    expect(wageringResponses['400']).toBeDefined();
    expect(wageringResponses['404']).toBeDefined();
    expect(wageringResponses['409']).toBeDefined();
    expect(walletListParameter).toEqual({
      name: 'limit',
      required: false,
      in: 'query',
      description: 'Quantidade de wallets, de 1 a 100.',
      schema: { type: 'number', example: 20 },
    });
    expect(idempotencyParameters).toEqual([{
      name: 'idempotency-key',
      required: true,
      in: 'header',
      description: 'Identificador único da operação; reutilize-o somente ao repetir a mesma requisição.',
      schema: { type: 'string', example: 'demo-bet-001' },
    }]);
  });
});

async function createWallet(baseUrl: string, playerId: string): Promise<ApiResponse> {
  const wallet = await json(await fetch(`${baseUrl}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
  }));
  expect(wallet.response.status).toBe(201);
  return wallet.body;
}

function wagerRequest({
  playerId,
  walletId,
  externalTransactionId,
  amount = '25.00',
  kind = 'BET',
  referenceExternalTransactionId,
}: WagerRequestOptions) {
  return {
    providerId: 'provider-http',
    externalTransactionId,
    playerId,
    walletId,
    roundId: 'round-http',
    gameId: 'game-http',
    kind,
    money: { amount, currency: 'BRL' },
    ...(referenceExternalTransactionId === undefined ? {} : { referenceExternalTransactionId }),
  };
}

async function json<T = ApiResponse>(response: Response): Promise<{ response: Response; body: T }> {
  return { response, body: await response.json() as T };
}

interface ApiResponse {
  id: string;
  balance: { amount: string; currency: string };
  transactionId: string;
  idempotentReplay: boolean;
  externalTransactionId: string;
}

interface ApiError {
  statusCode: number;
  message?: string[];
}

interface PendingWagerResponse {
  status: string;
}

interface WalletListResponse {
  items: Array<{ id: string }>;
  limit: number;
}

interface WalletReconciliationResponse {
  walletId: string;
  storedBalance: { amount: string; currency: string };
  calculatedBalance: { amount: string; currency: string };
  difference: { amount: string; currency: string };
  consistent: boolean;
  checkedEntries: number;
}

interface WagerRequestOptions {
  playerId: string;
  walletId: string;
  externalTransactionId: string;
  amount?: string;
  kind?: 'BET' | 'REFUND' | 'OPENING';
  referenceExternalTransactionId?: string;
}

interface SwaggerDocument {
  paths: {
    '/wallets': {
      post: { responses: Record<string, unknown> };
      get: {
        parameters: Array<{
          name: string;
          required: boolean;
          in: string;
          description: string;
          schema: { type: string; example: number };
        }>;
      };
    };
    '/wagering/transactions': {
      post: {
        responses: Record<string, unknown>;
        parameters: Array<{
          name: string;
          required: boolean;
          in: string;
          description: string;
          schema: { type: string; example: string };
        }>;
      };
    };
  };
}
