/**
 * Redis connection for BullMQ.
 *
 * Uses a single IORedis instance shared across all queues and workers.
 * Key namespace strategy (ADR-014):
 *   bull:      → BullMQ queue data (set as BullMQ prefix)
 *   rl:        → Rate limit counters (managed by Pre-Enqueue Guard, SEC-09)
 *   ai_budget: → Global AI token budget guard (SEC-09)
 *
 * Note: BullMQ manages its own key prefix via QueueOptions.prefix.
 * The rl: and ai_budget: keys are managed directly by application code.
 */

import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Singleton connection reused by all BullMQ Queues and Workers.
// BullMQ requires maxRetriesPerRequest: null for blocking commands.
export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
});

redisConnection.on('connect', () => {
  console.log('[midas:redis] Connected to Redis');
});

redisConnection.on('error', (err: Error) => {
  // Log error class only — no secrets or payload data (SEC-12)
  console.error('[midas:redis] Connection error:', err.constructor.name, err.message);
});

/**
 * Gracefully close the Redis connection.
 * Call during process shutdown AFTER all workers have stopped.
 */
export async function closeRedis(): Promise<void> {
  await redisConnection.quit();
}
