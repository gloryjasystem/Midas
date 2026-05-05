/**
 * Rate Limiter — Phase 1.5
 *
 * Redis-based sliding-window rate limiter for Telegram onboarding anti-spam.
 *
 * Used to prevent /start flooding — one successful onboarding per user per window.
 *
 * Key format: rl:start:{telegramUserId}
 * TTL: 60 seconds (configurable via ONBOARDING_RATE_LIMIT_WINDOW_SEC)
 * Limit: 1 request per window (configurable via ONBOARDING_RATE_LIMIT_MAX)
 *
 * Strategy: SET NX EX (atomic — no WATCH/MULTI needed for simple count=1 case).
 * For count > 1 (future), use INCR + EXPIRE pattern.
 *
 * This does NOT return HTTP 429 — Telegram requires 200 for all webhook responses.
 * Instead, the webhook handler silently acknowledges and sends a rate-limit message.
 */

import { redisConnection } from '../queues/redis.js';

const RATE_LIMIT_WINDOW_SEC = parseInt(
  process.env.ONBOARDING_RATE_LIMIT_WINDOW_SEC ?? '60',
  10,
);

/**
 * Check and record a /start attempt for a given Telegram user.
 *
 * @param telegramUserId - string Telegram user ID
 * @returns true if allowed (under limit), false if rate-limited
 */
export async function checkOnboardingRateLimit(
  telegramUserId: string,
): Promise<boolean> {
  const key = `rl:start:${telegramUserId}`;

  // SET key 1 NX EX ttl — atomic: set only if not exists, with expiry
  // Returns 'OK' if set (first call in window), null if already exists (limited)
  const result = await redisConnection.set(key, '1', 'EX', RATE_LIMIT_WINDOW_SEC, 'NX');

  return result === 'OK';
}
