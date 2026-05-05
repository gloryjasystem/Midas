/**
 * Redis connection for telegram-bot service.
 *
 * Separate from background-workers Redis singleton — each service
 * manages its own connection. BullMQ Queue (producer-only) needs
 * a Redis connection with maxRetriesPerRequest: null.
 *
 * This service is a PRODUCER only — it adds jobs to queues.
 * It does NOT run workers (that is background-workers' responsibility).
 *
 * Key namespace strategy (ADR-014):
 *   bull:      → BullMQ queue data
 *   rl:        → Rate limit counters (written by background-workers)
 *   ai_budget: → AI token budget (written by background-workers)
 */

import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
});

redisConnection.on('connect', () => {
  console.log('[midas:bot:redis] Connected to Redis');
});

redisConnection.on('error', (err: Error) => {
  // Log error class only — no secrets or payload data (SEC-12)
  console.error('[midas:bot:redis] Connection error:', err.constructor.name, err.message);
});

export async function closeRedis(): Promise<void> {
  await redisConnection.quit();
}
