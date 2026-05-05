/**
 * @midas/telegram-bot — Entry Point
 *
 * Phase 1.5: User Onboarding & Workspace Resolution
 *   - Phase 1.4: Fastify HTTP server, SEC-04/05/06/12
 *   - Phase 1.5: Real resolveWorkspace() via DB, /start onboarding, anti-spam guard
 *
 * Startup sequence:
 *   1. Build Fastify server (register plugins, routes)
 *   2. Listen on PORT (default: 3000)
 *   3. Register graceful shutdown handlers
 *
 * Shutdown sequence (SIGTERM / SIGINT):
 *   1. Close Fastify server (stop accepting new requests)
 *   2. Close BullMQ queue connections
 *   3. Close Redis connection
 *   4. Close PostgreSQL pool
 */

import { buildServer } from './server.js';
import { closeQueues } from './queues/webhook-queue.js';
import { closeRedis } from './queues/redis.js';
import { closeDb } from '@midas/database';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = '0.0.0.0';

async function main(): Promise<void> {
  const server = await buildServer();

  // ── Graceful shutdown ─────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    server.log.info(`[midas:bot] Received ${signal} — shutting down gracefully...`);

    // 1. Close Fastify (drain in-flight requests)
    await server.close();
    server.log.info('[midas:bot] HTTP server closed');

    // 2. Close BullMQ queue connections
    await closeQueues();

    // 3. Close Redis
    await closeRedis();

    // 4. Close PostgreSQL pool (Phase 1.5+)
    await closeDb();

    server.log.info('[midas:bot] Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('uncaughtException', (err: Error) => {
    server.log.error({
      msg: '[midas:bot] Uncaught exception',
      errorClass: err.constructor.name,
      // message may be safe but err.stack could leak paths — log class only in prod
      ...(process.env.NODE_ENV !== 'production' && { errorMessage: err.message }),
    });
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const errorClass = reason instanceof Error ? reason.constructor.name : typeof reason;
    server.log.error({
      msg: '[midas:bot] Unhandled rejection',
      errorClass,
    });
    void shutdown('unhandledRejection');
  });

  // ── Start server ──────────────────────────────────────────
  await server.listen({ port: PORT, host: HOST });

  server.log.info({
    msg: '[midas:bot] Telegram Bot server started',
    port: PORT,
    host: HOST,
    webhookPath: '/webhook',
    healthPath: '/health',
    phase: '1.5',
  });
}

void main();
