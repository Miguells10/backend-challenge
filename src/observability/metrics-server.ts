import { MetricsService } from './metrics.service';
import { StructuredLogger } from './structured-logger.service';

export interface MetricsServer {
  stop(): Promise<void>;
}

export function startMetricsServer(metrics: MetricsService, logger: StructuredLogger): MetricsServer {
  const port = positiveIntegerFromEnvironment('METRICS_PORT', 9464);
  const server = Bun.serve({
    port,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname !== '/metrics') {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(await metrics.render(), {
        headers: { 'Content-Type': metrics.contentType },
      });
    },
  });
  logger.info('metrics_server_started', { port });

  return {
    stop: async () => {
      await server.stop(true);
    },
  };
}

function positiveIntegerFromEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return value;
}
