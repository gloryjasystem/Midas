/**
 * Draft Expiration Worker — Phase 1.7
 *
 * Processes jobs from the `draft-expiration` queue.
 * This is a scheduled/repeatable system CRON worker.
 *
 * Architecture:
 *   - BullMQ repeatable job (every 5 minutes) triggers this worker.
 *   - Worker calls expirePendingDrafts() which invokes the
 *     system_expire_pending_drafts() SECURITY DEFINER DB function.
 *   - The DB function atomically updates all eligible drafts in one SQL statement.
 *   - Idempotent: running multiple times has no side effect — already-expired
 *     and terminal drafts are excluded by the DB WHERE clause.
 *
 * CRON deduplication:
 *   - Repeatable jobs are registered with a fixed jobId pattern by BullMQ.
 *   - If the worker is restarted, BullMQ does NOT create duplicate repeatable
 *     job definitions — it upserts by (name, repeat key).
 *   - Concurrency is set to 1 to prevent overlapping runs within the same worker
 *     process (DB function itself is safe if overlapping, but single concurrency
 *     avoids redundant DB calls).
 *
 * SEC-12: No raw_text or user PII in any log output.
 * SEC-03: No tenant context needed — system_expire_pending_drafts is SECURITY DEFINER.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';
import { expirePendingDrafts } from '../services/draft-expiration.service.js';

// ─────────────────────────────────────────────────────────────
// CRON schedule
// ─────────────────────────────────────────────────────────────

/**
 * Expiration CRON interval.
 * Every 5 minutes — balances responsiveness with DB load.
 * drafts.expires_at is indexed (idx_transaction_drafts_expires_at),
 * so this UPDATE is efficient even at scale.
 */
export const EXPIRATION_CRON_PATTERN = '*/5 * * * *'; // every 5 minutes

/**
 * Fixed jobId for the repeatable CRON trigger.
 * BullMQ uses this as the stable identifier for the repeatable job definition.
 * Using a fixed ID prevents duplicate CRON registrations on worker restart.
 */
export const EXPIRATION_CRON_JOB_ID = 'system|draft-expiration|cron';

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processExpiration(job: Job): Promise<void> {
  console.log('[midas:draft-expiration-worker] Expiration run started', {
    jobId: job.id,
    // No workspace, no user, no payload data to log
  });

  const { expiredCount } = await expirePendingDrafts();

  console.log('[midas:draft-expiration-worker] Expiration run complete', {
    jobId: job.id,
    expiredCount,
    // SEC-12: count only, no draft IDs or raw_text
  });
}

// ─────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────

export function createDraftExpirationWorker(): Worker {
  const worker = new Worker(QUEUE_NAMES.DRAFT_EXPIRATION, processExpiration, {
    connection: redisConnection,
    prefix: 'bull',
    concurrency: 1, // Single-instance CRON — no parallel expiration runs
  });

  worker.on('completed', (job: Job) => {
    console.log('[midas:draft-expiration-worker] Job completed', {
      jobId: job.id,
    });
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error('[midas:draft-expiration-worker] Job failed', {
      jobId: job?.id ?? 'unknown',
      errorClass: err.constructor.name,
      // No payload data (SEC-12)
    });
  });

  return worker;
}
