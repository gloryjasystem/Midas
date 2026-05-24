/**
 * @midas/background-workers
 *
 * Entry point for BullMQ worker processes.
 *
 * Phase 1.3: BullMQ Task Queue Foundation
 * Queues: webhook-ingestion, ai-parse, notifications
 *
 * Phase 1.7: Draft Expiration — draft-expiration CRON queue added.
 *
 * Startup order:
 *   1. Redis connection (via queue-definitions import)
 *   2. Register repeatable CRON job for draft expiration
 *   3. Start all worker processors
 *   4. Attach DLQ (QueueEvents) handlers to all queues
 *   5. Register graceful shutdown handlers (SIGTERM, SIGINT)
 *
 * SEC-03: workspace_id always comes from job payload, never global state
 * SEC-09: Rate limiting enforced in webhook-ingestion worker (Redis INCR)
 * SEC-12: raw_text never logged; all log contexts are sanitized
 */

import { closeRedis } from './queues/redis.js';
import { closeQueues, draftExpirationQueue, summaryDispatchQueue, recurringReminderQueue } from './queues/queue-definitions.js';
import { attachDlqHandler } from './queues/dlq-handler.js';
import { createWebhookIngestionWorker } from './workers/webhook-ingestion.worker.js';
import { createAiParseWorker } from './workers/ai-parse.worker.js';
import { createNotificationsWorker } from './workers/notifications.worker.js';
import { createConfirmationWorker } from './workers/confirmation.worker.js';
import {
  createDraftExpirationWorker,
  EXPIRATION_CRON_PATTERN,
  EXPIRATION_CRON_JOB_ID,
} from './workers/draft-expiration.worker.js';
import { createVoiceParseWorker } from './workers/voice-parse.worker.js';
import {
  createSummaryDispatchWorker,
  SUMMARY_CRON_PATTERN,
  SUMMARY_CRON_JOB_ID,
} from './workers/summary-dispatch.worker.js';
import {
  createRecurringReminderWorker,
  RECURRING_CRON_PATTERN,
  RECURRING_CRON_JOB_ID,
} from './workers/recurring-reminder.worker.js';
import { runMigrations } from './migrate.js';
import { QUEUE_NAMES } from '@midas/shared';
import type { QueueEvents } from 'bullmq';

console.log('[midas] background-workers starting...');

// ─────────────────────────────────────────────────────────────
// Step 0: Run pending DB migrations before starting workers
// ─────────────────────────────────────────────────────────────

await runMigrations();

// ─────────────────────────────────────────────────────────────
// Register repeatable CRON job for draft expiration (Phase 1.7)
// BullMQ upserts repeatable jobs by name+repeat key — safe on restart.
// ─────────────────────────────────────────────────────────────

await draftExpirationQueue.add(
  'expire-pending-drafts',
  {}, // No payload — system job
  {
    jobId: EXPIRATION_CRON_JOB_ID,
    repeat: {
      pattern: EXPIRATION_CRON_PATTERN, // Every 5 minutes
    },
    // removeOnComplete is set in queue defaultJobOptions
  },
);

console.log(`[midas] Draft expiration CRON registered: ${EXPIRATION_CRON_PATTERN}`);

// Phase 7.0-A: Register summary dispatch CRON
await summaryDispatchQueue.add(
  'dispatch-daily-summaries',
  {},
  {
    jobId: SUMMARY_CRON_JOB_ID,
    repeat: { pattern: SUMMARY_CRON_PATTERN },
  },
);
console.log(`[midas] Summary dispatch CRON registered: ${SUMMARY_CRON_PATTERN}`);

// Phase 7.0-C: Register recurring reminder CRON
await recurringReminderQueue.add(
  'send-recurring-reminders',
  {},
  {
    jobId: RECURRING_CRON_JOB_ID,
    repeat: { pattern: RECURRING_CRON_PATTERN },
  },
);
console.log(`[midas] Recurring reminder CRON registered: ${RECURRING_CRON_PATTERN}`);

// ─────────────────────────────────────────────────────────────
// Start workers
// ─────────────────────────────────────────────────────────────

const webhookWorker = createWebhookIngestionWorker();
const aiParseWorker = createAiParseWorker();
const notificationsWorker = createNotificationsWorker();
const confirmationWorker = createConfirmationWorker();
const expirationWorker = createDraftExpirationWorker();
const voiceParseWorker = createVoiceParseWorker();
const summaryDispatchWorker = createSummaryDispatchWorker();
const recurringReminderWorker = createRecurringReminderWorker();

console.log('[midas] Workers started:');
console.log(`  ✓ ${QUEUE_NAMES.WEBHOOK_INGESTION} (concurrency: 10)`);
console.log(`  ✓ ${QUEUE_NAMES.AI_PARSE} (concurrency: 5, rate-limit: 50/60s)`);
console.log(`  ✓ ${QUEUE_NAMES.VOICE_PARSE} (concurrency: 3, rate-limit: 30/60s)`);
console.log(`  ✓ ${QUEUE_NAMES.NOTIFICATIONS} (concurrency: 10, rate-limit: 30/1s)`);
console.log(`  ✓ ${QUEUE_NAMES.CALLBACK_CONFIRM} (concurrency: 5)`);
console.log(`  ✓ ${QUEUE_NAMES.DRAFT_EXPIRATION} (concurrency: 1, CRON: ${EXPIRATION_CRON_PATTERN})`);
console.log(`  ✓ ${QUEUE_NAMES.SUMMARY_DISPATCH} (concurrency: 1, CRON: ${SUMMARY_CRON_PATTERN})`);
console.log(`  ✓ ${QUEUE_NAMES.RECURRING_REMINDER} (concurrency: 1, CRON: ${RECURRING_CRON_PATTERN})`);

// ─────────────────────────────────────────────────────────────
// Attach DLQ handlers (QueueEvents — fires on permanent failures)
// ─────────────────────────────────────────────────────────────

const dlqHandlers: QueueEvents[] = [
  attachDlqHandler(QUEUE_NAMES.WEBHOOK_INGESTION),
  attachDlqHandler(QUEUE_NAMES.AI_PARSE),
  attachDlqHandler(QUEUE_NAMES.VOICE_PARSE),
  attachDlqHandler(QUEUE_NAMES.CALLBACK_CONFIRM),
  attachDlqHandler(QUEUE_NAMES.NOTIFICATIONS),
  attachDlqHandler(QUEUE_NAMES.DRAFT_EXPIRATION),
  attachDlqHandler(QUEUE_NAMES.SUMMARY_DISPATCH),
  attachDlqHandler(QUEUE_NAMES.RECURRING_REMINDER),
];

console.log('[midas] DLQ handlers (QueueEvents) attached to all queues');
console.log('[midas] Phase 1.7: Draft Expiration ready');

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
    expirationWorker.close(),
    voiceParseWorker.close(),
    summaryDispatchWorker.close(),
    recurringReminderWorker.close(),
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

