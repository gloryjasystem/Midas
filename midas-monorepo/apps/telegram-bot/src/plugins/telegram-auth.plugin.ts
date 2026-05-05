/**
 * Fastify plugin: Telegram webhook authentication (SEC-04).
 *
 * Telegram sends a header `X-Telegram-Bot-Api-Secret-Token` on every
 * webhook request when the token is configured in setWebhook().
 *
 * SEC-04 requirements:
 *   - Verify the header value against TELEGRAM_WEBHOOK_SECRET env var
 *   - Requests without or with invalid token → HTTP 403, not processed
 *   - Valid requests → HTTP 200 returned immediately (after queue.add)
 *   - Constant-time comparison to prevent timing attacks
 *
 * Registration: applied globally via fastify.addHook('preHandler')
 * so it guards ALL routes on this server.
 *
 * NOTE: The secret token is set via setWebhook() call, not included
 * in bot token. It's a separate 1-256 character secret of your choice.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { timingSafeEqual } from 'node:crypto';

const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true if both strings are equal.
 */
function safeCompare(a: string, b: string): boolean {
  // If lengths differ, timing still leaks. Pad to equal length first.
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Still run timingSafeEqual to avoid early-exit timing leak,
    // but return false regardless.
    timingSafeEqual(Buffer.alloc(bufA.length), Buffer.alloc(bufA.length));
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

const telegramAuthPlugin: FastifyPluginAsync = async (fastify) => {
  // Await a no-op: Fastify plugins must be async, but this one only registers
  // synchronous hooks. Promise.resolve() satisfies require-await lint rule.
  await Promise.resolve();

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedSecret) {
    // In production this is a fatal misconfiguration.
    // In development (no TELEGRAM_WEBHOOK_SECRET set), we warn but continue.
    // This allows local dev without Telegram connectivity.
    fastify.log.warn(
      '[midas:bot:auth] TELEGRAM_WEBHOOK_SECRET not set — SEC-04 enforcement disabled (dev mode only)',
    );
  }

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Exclude public routes from SEC-04 enforcement
    if (request.url === '/health') {
      return;
    }

    // If no secret configured (dev mode), skip auth
    if (!expectedSecret) {
      return;
    }

    const receivedToken = request.headers[TELEGRAM_SECRET_HEADER];

    if (typeof receivedToken !== 'string' || !safeCompare(receivedToken, expectedSecret)) {
      request.log.warn({
        msg: '[midas:bot:auth] SEC-04 rejected: invalid or missing secret token',
        // Do NOT log the received token value (could be probing attempt)
        hasHeader: typeof receivedToken === 'string',
        ip: request.ip,
      });

      await reply.status(403).send({ error: 'Forbidden' });
      return;
    }
  });
};

// fastify-plugin unwraps the encapsulation so the hook applies globally
export default fp(telegramAuthPlugin, {
  name: 'telegram-auth',
});
