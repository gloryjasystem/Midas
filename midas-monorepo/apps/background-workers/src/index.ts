/**
 * @midas/background-workers
 *
 * Entry point for BullMQ worker processes.
 *
 * Phase 1.3: BullMQ Task Queue Foundation
 * Queues: webhook-ingestion, ai-parse, notifications
 *
 * Startup order:
 *   1. Redis connection (via queue-definitions import)
 *   2. Start all worker processors
 *   3. Attach DLQ (QueueEvents) handlers to all queues
 *   4. Register graceful shutdown handlers (SIGTERM, SIGINT)
 *
 * SEC-03: workspace_id always comes from job payload, never global state
 * SEC-09: Rate limiting enforced in webhook-ingestion worker (Redis INCR)
 * SEC-12: raw_text never logged; all log contexts are sanitized
 */

import { closeRedis } from './queues/redis.js';
import { closeQueues } from './queues/queue-definitions.js';
import { attachDlqHandler } from './queues/dlq-handler.js';
import { createWebhookIngestionWorker } from './workers/webhook-ingestion.worker.js';
import { createAiParseWorker } from './workers/ai-parse.worker.js';
import { createNotificationsWorker } from './workers/notifications.worker.js';
import { createConfirmationWorker } from './workers/confirmation.worker.js';
import { QUEUE_NAMES } from '@midas/shared';
import type { QueueEvents } from 'bullmq';

console.log('[midas] background-workers starting...');

// ─────────────────────────────────────────────────────────────
// Start workers
// ─────────────────────────────────────────────────────────────

const webhookWorker = createWebhookIngestionWorker();
const aiParseWorker = createAiParseWorker();
const notificationsWorker = createNotificationsWorker();
const confirmationWorker = createConfirmationWorker();

console.log('[midas] Workers started:');
console.log(`  ✓ ${QUEUE_NAMES.WEBHOOK_INGESTION} (concurrency: 10)`);
console.log(`  ✓ ${QUEUE_NAMES.AI_PARSE} (concurrency: 5, rate-limit: 50/60s)`);
console.log(`  ✓ ${QUEUE_NAMES.NOTIFICATIONS} (concurrency: 10, rate-limit: 30/1s)`);
console.log(`  ✓ ${QUEUE_NAMES.CALLBACK_CONFIRM} (concurrency: 5)`);

// ─────────────────────────────────────────────────────────────
// Attach DLQ handlers (QueueEvents — fires on permanent failures)
// ─────────────────────────────────────────────────────────────

const dlqHandlers: QueueEvents[] = [
  attachDlqHandler(QUEUE_NAMES.WEBHOOK_INGESTION),
  attachDlqHandler(QUEUE_NAMES.AI_PARSE),
  attachDlqHandler(QUEUE_NAMES.CALLBACK_CONFIRM),
  attachDlqHandler(QUEUE_NAMES.NOTIFICATIONS),
];

console.log('[midas] DLQ handlers (QueueEvents) attached to all queues');
console.log('[midas] Phase 1.3: BullMQ Task Queue Foundation ready');

// ─────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[midas] Received ${signal} — shutting down workers gracefully...`);

  // Close workers first (stops accepting new jobs, waits for active jobs)
  await Promise.all([
    webhookWorker.close(),
    aiParseWorker.close(),
    notificationsWorker.close(),
    confirmationWorker.close(),
  ]);

  console.log('[midas] All workers stopped');

  // Close QueueEvents listeners
  await Promise.all(dlqHandlers.map((qe) => qe.close()));

  // Close queue connections
  await closeQueues();

  // Close Redis connection last
  await closeRedis();

  console.log('[midas] Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

// Handle uncaught errors — log error class only, never payload (SEC-12)
process.on('uncaughtException', (err: Error) => {
  console.error('[midas] Uncaught exception:', err.constructor.name, err.message);
  void gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: unknown) => {
  const errorClass = reason instanceof Error ? reason.constructor.name : typeof reason;
  console.error('[midas] Unhandled rejection:', errorClass);
  void gracefulShutdown('unhandledRejection');
});
