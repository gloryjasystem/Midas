/**
 * Dead Letter Queue (DLQ) Handler.
 *
 * Uses BullMQ's QueueEvents to subscribe to 'failed' events on all queues.
 * On job failure (max retries exceeded or unrecoverable error):
 *   1. Logs sanitized error context (SEC-12: no raw_text, no tokens)
 *   2. Stubs Sentry capture (to be wired in Phase 1.4 with real Sentry DSN)
 *   3. Stubs AuditLog persistence (to be wired when audit_logs table is accessible)
 *
 * Why QueueEvents and not Worker 'failed' event:
 *   - Worker-level 'failed' fires on each failed attempt (including retries).
 *   - QueueEvents 'failed' fires after all retries are exhausted (permanent failure).
 *   - For DLQ/alerting purposes, we only care about permanently failed jobs.
 *
 * IMPORTANT — SEC-12 Privacy:
 *   - raw_text is NEVER included in DLQ logs or Sentry events
 *   - Only allowed: job_id, error_class, workspace_id, draft_id, queue_name
 *
 * docs/queue_model.md §3 — Dead Letter Queue
 */

import { QueueEvents } from 'bullmq';
import type { QueueName } from '@midas/shared';
import { redisConnection } from './redis.js';

interface FailedEventArgs {
  jobId: string;
  failedReason: string;
  prev?: string;
}

/**
 * Create and attach a QueueEvents DLQ listener for a queue.
 * Returns the QueueEvents instance so it can be closed during shutdown.
 *
 * @param queueName - The canonical queue name to monitor
 */
export function attachDlqHandler(queueName: QueueName): QueueEvents {
  const queueEvents = new QueueEvents(queueName, {
    connection: redisConnection,
    prefix: 'bull',
  });

  queueEvents.on('failed', ({ jobId, failedReason }: FailedEventArgs) => {
    // Build log-safe entry — no raw_text, no user financial data (SEC-12)
    const logEntry = {
      queueName,
      jobId,
      // failedReason is the error message from BullMQ — may contain error class info
      // Truncate to avoid accidental data leakage
      failedReason: failedReason.slice(0, 200),
    };

    console.error('[midas:dlq] Job permanently failed:', JSON.stringify(logEntry));

    // ── Sentry stub ─────────────────────────────────────────
    // TODO Phase 1.4: wire real Sentry DSN from env
    // Sentry.captureMessage('BullMQ job permanently failed', {
    //   level: 'error',
    //   extra: logEntry,
    // });

    // ── AuditLog stub ────────────────────────────────────────
    // TODO Phase 1.4: persist to audit_logs table via withTenantTransaction
    // Note: workspace_id is not available from QueueEvents alone.
    // In Phase 1.4, use a Worker-level 'failed' listener with full payload access
    // for audit log writes, in addition to this QueueEvents listener for alerting.
  });

  queueEvents.on('error', (err: Error) => {
    console.error('[midas:dlq] QueueEvents error on queue:', queueName, err.constructor.name);
  });

  return queueEvents;
}
