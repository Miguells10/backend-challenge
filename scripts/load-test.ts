import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

interface LoadTestConfig {
  baseUrl: string;
  requests: number;
  concurrency: number;
  initialBalance: string;
  betAmount: string;
  outboxWaitMs: number;
  outboxDrainTimeoutMs: number;
}

interface WalletResponse {
  id: string;
  playerId: string;
}

interface WagerResponse {
  status: 'PROCESSED' | 'REJECTED' | 'PENDING_REFERENCE';
  idempotentReplay: boolean;
}

interface ReconciliationResponse {
  consistent: boolean;
  storedBalance: { amount: string };
}

interface TimedResponse {
  durationMs: number;
  statusCode: number;
  body: unknown;
  error?: string;
}

const config = readConfig();
const runId = crypto.randomUUID();

async function main(): Promise<void> {
  await assertApiIsReady();

  const throughputWallet = await createWallet(centsToMoney(requiredBalanceCents()));
  const throughputStartedAt = performance.now();
  const responses = await runWithConcurrency(
    Array.from({ length: config.requests }, (_, index) => () => submitBet(throughputWallet, index)),
    config.concurrency,
  );
  const throughputDurationMs = performance.now() - throughputStartedAt;
  const contention = await runContentionScenario();

  await delay(config.outboxWaitMs);
  const reconciliation = await reconcile(throughputWallet.id);
  const outbox = await observeOutbox(throughputWallet.id);
  const report = buildReport(responses, throughputDurationMs, throughputWallet, reconciliation, contention, outbox);

  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));

  if (!isSuccessful(report)) {
    process.exitCode = 1;
  }
}

function readConfig(): LoadTestConfig {
  const requests = positiveInteger('LOAD_TEST_REQUESTS', 100);
  const betAmount = process.env.LOAD_TEST_BET_AMOUNT ?? '1.00';
  const initialBalance = process.env.LOAD_TEST_INITIAL_BALANCE ?? centsToMoney(moneyToCents(betAmount) * BigInt(requests + 1));

  if (moneyToCents(initialBalance) < moneyToCents(betAmount) * BigInt(requests)) {
    throw new Error('LOAD_TEST_INITIAL_BALANCE must cover every throughput request.');
  }

  return {
    baseUrl: (process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    requests,
    concurrency: positiveInteger('LOAD_TEST_CONCURRENCY', 20),
    initialBalance,
    betAmount,
    outboxWaitMs: positiveInteger('LOAD_TEST_OUTBOX_WAIT_MS', 1_500),
    outboxDrainTimeoutMs: positiveInteger('LOAD_TEST_OUTBOX_DRAIN_TIMEOUT_MS', 10_000),
  };
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function moneyToCents(value: string): bigint {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Invalid money value "${value}". Use a decimal string with two places.`);
  }
  return BigInt(match[1]) * 100n + BigInt(match[2]);
}

function centsToMoney(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function requiredBalanceCents(): bigint {
  return moneyToCents(config.initialBalance);
}

async function assertApiIsReady(): Promise<void> {
  const response = await fetch(`${config.baseUrl}/health/live`);
  if (!response.ok) {
    throw new Error(`API is not ready at ${config.baseUrl}. Start Docker Compose before running the load test.`);
  }
}

async function createWallet(initialBalance: string): Promise<WalletResponse> {
  const response = await fetch(`${config.baseUrl}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerId: crypto.randomUUID(),
      initialBalance: { amount: initialBalance, currency: 'BRL' },
    }),
  });

  if (response.status !== 201) {
    throw new Error(`Could not create the load-test wallet (HTTP ${response.status}).`);
  }
  return response.json() as Promise<WalletResponse>;
}

async function submitBet(wallet: WalletResponse, index: number): Promise<TimedResponse> {
  const externalTransactionId = `load-${runId}-${index}`;
  return timedFetch(`${config.baseUrl}/wagering/transactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `load-test:${externalTransactionId}`,
    },
    body: JSON.stringify({
      providerId: 'load-test',
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: `load-round-${runId}`,
      gameId: 'load-test-game',
      kind: 'BET',
      money: { amount: config.betAmount, currency: 'BRL' },
    }),
  });
}

async function runContentionScenario(): Promise<{ processed: number; rejected: number; consistent: boolean; balance: string }> {
  const wallet = await createWallet('100.00');
  const responses = await Promise.all([0, 1].map((index) => timedFetch(`${config.baseUrl}/wagering/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `load-contention:${runId}:${index}` },
    body: JSON.stringify({
      providerId: 'load-contention',
      externalTransactionId: `contention-${runId}-${index}`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: `contention-round-${runId}`,
      gameId: 'load-test-game',
      kind: 'BET',
      money: { amount: '80.00', currency: 'BRL' },
    }),
  })));
  const reconciliation = await reconcile(wallet.id);
  const bodies = responses.map((response) => response.body as WagerResponse);

  return {
    processed: bodies.filter((body) => body.status === 'PROCESSED').length,
    rejected: bodies.filter((body) => body.status === 'REJECTED').length,
    consistent: reconciliation.consistent,
    balance: reconciliation.storedBalance.amount,
  };
}

async function reconcile(walletId: string): Promise<ReconciliationResponse> {
  const response = await fetch(`${config.baseUrl}/wallets/${walletId}/reconciliation`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Could not reconcile load-test wallet (HTTP ${response.status}).`);
  }
  return response.json() as Promise<ReconciliationResponse>;
}

async function timedFetch(url: string, init: RequestInit): Promise<TimedResponse> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, init);
    return { durationMs: performance.now() - startedAt, statusCode: response.status, body: await response.json() };
  } catch (error) {
    return {
      durationMs: performance.now() - startedAt,
      statusCode: 0,
      body: undefined,
      error: error instanceof Error ? error.message : 'Unknown request error',
    };
  }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let nextTaskIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextTaskIndex < tasks.length) {
      const task = tasks[nextTaskIndex++];
      if (task !== undefined) results.push(await task());
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

async function readOutboxLagSeconds(walletId: string): Promise<number | null> {
  const command = ['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'wagering', '-d', 'wagering', '-At', '-c',
    `SELECT COALESCE(EXTRACT(EPOCH FROM NOW() - MIN(outbox.occurred_at)), 0)
       FROM outbox_messages outbox
       LEFT JOIN wager_transactions transaction ON transaction.id = outbox.aggregate_id
      WHERE outbox.published_at IS NULL
        AND (outbox.aggregate_id = '${walletId}' OR transaction.wallet_id = '${walletId}');`,
  ];
  try {
    const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, exitCode] = await Promise.all([new Response(process.stdout).text(), process.exited]);
    if (exitCode !== 0) return null;
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function observeOutbox(walletId: string): Promise<{ lagSecondsAfterWait: number | null; drainedAfterMs: number | null }> {
  const lagSecondsAfterWait = await readOutboxLagSeconds(walletId);
  if (lagSecondsAfterWait === null || lagSecondsAfterWait === 0) {
    return { lagSecondsAfterWait, drainedAfterMs: lagSecondsAfterWait === 0 ? 0 : null };
  }

  const startedAt = performance.now();
  while (performance.now() - startedAt < config.outboxDrainTimeoutMs) {
    await delay(500);
    const currentLag = await readOutboxLagSeconds(walletId);
    if (currentLag === null) return { lagSecondsAfterWait, drainedAfterMs: null };
    if (currentLag === 0) {
      return { lagSecondsAfterWait, drainedAfterMs: round(performance.now() - startedAt) };
    }
  }
  return { lagSecondsAfterWait, drainedAfterMs: null };
}

function buildReport(
  responses: TimedResponse[],
  durationMs: number,
  wallet: WalletResponse,
  reconciliation: ReconciliationResponse,
  contention: { processed: number; rejected: number; consistent: boolean; balance: string },
  outbox: { lagSecondsAfterWait: number | null; drainedAfterMs: number | null },
) {
  const latencies = responses.map((response) => response.durationMs).sort((left, right) => left - right);
  const processed = responses.filter((response) => isWager(response.body, 'PROCESSED')).length;
  const rejected = responses.filter((response) => isWager(response.body, 'REJECTED')).length;
  const replays = responses.filter((response) => isReplay(response.body)).length;
  const httpErrors = responses.filter((response) => response.statusCode >= 400 || response.statusCode === 0).length;

  return {
    generatedAt: new Date().toISOString(),
    environment: {
      runtime: `Bun ${Bun.version}`,
      platform: process.platform,
      apiBaseUrl: config.baseUrl,
      scenario: 'One API instance and PostgreSQL/LocalStack through Docker Compose.',
    },
    methodology: {
      workload: `${config.requests} unique BET requests against one wallet, each with a unique idempotency key.`,
      concurrency: config.concurrency,
      betAmount: config.betAmount,
      initialBalance: config.initialBalance,
      outboxObservation: 'Direct PostgreSQL query scoped to this run wallet after the configured wait, followed by polling until it drains or reaches the timeout.',
    },
    throughput: {
      requests: responses.length,
      durationMs: round(durationMs),
      requestsPerSecond: round((responses.length * 1_000) / durationMs),
      processed,
      rejected,
      idempotentReplays: replays,
      httpErrors,
      latenciesMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
      },
    },
    concurrency: {
      hotWallet: contention,
      unexpectedHttpConflicts: responses.filter((response) => response.statusCode === 409).length,
    },
    consistency: {
      walletId: wallet.id,
      reconciled: reconciliation.consistent,
      storedBalance: reconciliation.storedBalance.amount,
      expectedBalance: centsToMoney(requiredBalanceCents() - moneyToCents(config.betAmount) * BigInt(config.requests)),
    },
    outbox: {
      lagSecondsAfterWait: outbox.lagSecondsAfterWait === null ? null : round(outbox.lagSecondsAfterWait),
      drainedAfterMs: outbox.drainedAfterMs,
    },
  };
}

function isWager(value: unknown, status: WagerResponse['status']): value is WagerResponse {
  return isRecord(value) && value.status === status;
}

function isReplay(value: unknown): boolean {
  return isRecord(value) && value.idempotentReplay === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  return round(values[Math.max(0, Math.ceil(values.length * percentileValue) - 1)] ?? 0);
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function isSuccessful(report: ReturnType<typeof buildReport>): boolean {
  return report.throughput.processed === config.requests
    && report.throughput.httpErrors === 0
    && report.consistency.reconciled
    && report.consistency.storedBalance === report.consistency.expectedBalance
    && report.concurrency.hotWallet.processed === 1
    && report.concurrency.hotWallet.rejected === 1
    && report.concurrency.hotWallet.consistent
    && report.concurrency.hotWallet.balance === '20.00';
}

async function writeReport(report: ReturnType<typeof buildReport>): Promise<void> {
  const directory = join(process.cwd(), 'artifacts');
  await mkdir(directory, { recursive: true });
  await Bun.write(join(directory, 'load-test-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void main();
