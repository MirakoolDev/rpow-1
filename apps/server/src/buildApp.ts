import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export interface BuildAppOptions { test?: boolean; pool?: Pool }

declare module 'fastify' {
  interface FastifyInstance { pool: Pool }
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.test ? false : { level: 'info' },
    disableRequestLogging: !!opts.test,
  });

  if (opts.pool) app.decorate('pool', opts.pool);

  app.get('/health', async () => ({ ok: true }));

  return app;
}
