/**
 * Fastify server factory for @midas/telegram-bot.
 *
 * Responsibilities:
 *   1. Create and configure Fastify instance
 *   2. Register telegram-auth plugin (SEC-04 global guard)
 *   3. Register webhook route
 *   4. Add health-check endpoint
 *
 * Port: process.env.PORT ?? 3000
 * Host: '0.0.0.0' (required for Docker)
 *
 * Logging:
 *   - JSON format in production (LOG_LEVEL=info)
 *   - Pretty format in development (LOG_LEVEL=debug)
 *   - SEC-12: raw_text must never reach the logger at any level
 *
 * Architecture note:
 *   Fastify is used as a thin HTTP transport layer only.
 *   Business logic lives in queue workers (apps/background-workers/).
 *   This server's only job: validate → filter → enqueue → 200.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import telegramAuthPlugin from './plugins/telegram-auth.plugin.js';
import webhookRoute from './routes/webhook.route.js';

export async function buildServer(): Promise<FastifyInstance> {
  const isDev = process.env.NODE_ENV !== 'production';

  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
      // Redact sensitive fields from ALL log output (SEC-12)
      redact: {
        paths: [
          'req.headers.x-telegram-bot-api-secret-token', // SEC-04 token
          'req.headers.authorization',
          'body.raw_text', // SEC-12: never log raw financial text
          '*.raw_text',
        ],
        censor: '[REDACTED]',
      },
      ...(isDev && {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      }),
    },
    // Trust proxy headers (X-Forwarded-For) in production behind reverse proxy
    trustProxy: !isDev,
  });

  // ── Plugins ──────────────────────────────────────────────────
  // formbody: parse application/x-www-form-urlencoded (defensive, Telegram sends JSON)
  await fastify.register(formbody);

  // SEC-04: Validate X-Telegram-Bot-Api-Secret-Token on ALL routes
  await fastify.register(telegramAuthPlugin);

  // ── Routes ───────────────────────────────────────────────────
  // Webhook route: POST /webhook
  await fastify.register(webhookRoute);

  // Health-check: GET /health (used by Docker, load balancers)
  // No auth guard — intentionally public
  fastify.get('/health', async (_request, reply) => {
    await reply.status(200).send({ status: 'ok', service: '@midas/telegram-bot' });
  });

  return fastify;
}
