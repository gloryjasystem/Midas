/**
 * BullMQ Queue Definitions — Phase 1 MVP queues only.
 *
 * Phase 1 queues:
 *   - webhook-ingestion : Fast Telegram webhook receipt (SEC-04, SEC-05, SEC-09)
 *   - ai-parse          : Claude API calls for NLP parsing
 *   - notifications     : Outbound Telegram messages / confirmations
 *
 * FORBIDDEN (Phase 2+): reports, integrations, blockchain
 *
 * Retry / backoff configuration per docs/queue_model.md:
 *   webhook-ingestion : 3 retries, exponential, 1s → 2s → 4s
 *   ai-parse          : 2 retries, fixed, 5s
 *   notifications     : 3 retries, exponential, 2s → 4s → 8s
 *
 * Idempotency: enforced by explicit jobId per SEC-06.
 * BullMQ deduplicates jobs with the same jobId in waiting/active/delayed state.
 *
 * Redis key prefix: 'bull' (ADR-014 namespace strategy).
 */

import { Queue, type DefaultJobOptions } from 'bullmq';
import { QUEUE_NAMES } from '@midas/shared';
import { redisConnection } from './redis.js';
import type {
  WebhookIngestionJobPayload,
  AiParseJobPayload,
  NotificationJobPayload,
  CallbackConfirmJobPayload,
  VoiceParseJobPayload,
} from '@midas/shared';

// ─────────────────────────────────────────────────────────────
// Shared Queue Options Base
// ─────────────────────────────────────────────────────────────

const BULL_PREFIX = 'bull';

// ─────────────────────────────────────────────────────────────
// webhook-ingestion Queue
// Concurrency: 10 | Rate limit: 100 jobs / 10s (user-level guard is pre-enqueue)
// ─────────────────────────────────────────────────────────────

const webhookIngestionDefaultJobOptions: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000, // 1s → 2s → 4s
  },
  removeOnComplete: {
    count: 1000, // Keep last 1000 completed jobs for inspection
  },
  removeOnFail: false, // Keep all failed jobs for DLQ review
};

export const webhookIngestionQueue = new Queue<WebhookIngestionJobPayload>(
  QUEUE_NAMES.WEBHOOK_INGESTION,
  {
    connection: redisConnection,
    prefix: BULL_PREFIX,
    defaultJobOptions: webhookIngestionDefaultJobOptions,
  },
);

// ─────────────────────────────────────────────────────────────
// ai-parse Queue
// Concurrency: 5 | Rate limit: 50 calls / 60s (Claude API tier)
// ─────────────────────────────────────────────────────────────

const aiParseDefaultJobOptions: DefaultJobOptions = {
  attempts: 3, // Phase 3.1: 3 retries for resilience against Anthropic InternalServerError
  backoff: {
    type: 'exponential',
    delay: 5000, // 5s → 10s → 20s — covers Anthropic transient 500 errors
  },
  removeOnComplete: {
    count: 500,
  },
  // SEC-12: ai-parse jobs contain raw_text in payload.
  // Failed jobs are auto-removed after 24h to prevent indefinite PII retention.
  // Double protection: job.updateData() redacts raw_text immediately on final failure.
  removeOnFail: {
    age: 86_400, // 24 hours in seconds (ADR-013 draft TTL matches)
  },
};


export const aiParseQueue = new Queue<AiParseJobPayload>(QUEUE_NAMES.AI_PARSE, {
  connection: redisConnection,
  prefix: BULL_PREFIX,
  defaultJobOptions: aiParseDefaultJobOptions,
});

// ─────────────────────────────────────────────────────────────
// callback-confirm Queue — Phase 1.6-B
// Processes inline keyboard approve/reject actions.
// Concurrency: 5 | No PII in payload — draftId + action only.
// ─────────────────────────────────────────────────────────────

const callbackConfirmDefaultJobOptions: DefaultJobOptions = {
  attempts: 2,
  backoff: {
    type: 'fixed',
    delay: 2_000, // 2s — DB operation is idempotent (SELECT FOR UPDATE SKIP LOCKED)
  },
  removeOnComplete: {
    count: 1000,
  },
  removeOnFail: false, // No PII in payload — retain for DLQ review
};

export const callbackConfirmQueue = new Queue<CallbackConfirmJobPayload>(
  QUEUE_NAMES.CALLBACK_CONFIRM,
  {
    connection: redisConnection,
    prefix: BULL_PREFIX,
    defaultJobOptions: callbackConfirmDefaultJobOptions,
  },
);

// ─────────────────────────────────────────────────────────────
// notifications Queue
// Concurrency: 10 | Rate limit: 30 / 1s (Telegram Flood Limit)
// ─────────────────────────────────────────────────────────────

const notificationsDefaultJobOptions: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000, // 2s → 4s → 8s
  },
  removeOnComplete: {
    count: 2000,
  },
  removeOnFail: false,
};

export const notificationsQueue = new Queue<NotificationJobPayload>(QUEUE_NAMES.NOTIFICATIONS, {
  connection: redisConnection,
  prefix: BULL_PREFIX,
  defaultJobOptions: notificationsDefaultJobOptions,
});

// ─────────────────────────────────────────────────────────────
// draft-expiration Queue — Phase 1.7
// Repeatable CRON queue for expiring pending_user drafts.
// Concurrency: 1 — single-instance CRON (expiration is atomic at DB layer)
// No user payload — system maintenance job, no PII.
// ─────────────────────────────────────────────────────────────

const draftExpirationDefaultJobOptions: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5_000, // 5s → 10s → 20s — DB hiccups only
  },
  removeOnComplete: {
    count: 100, // Keep last 100 completed runs for operational visibility
  },
  removeOnFail: false, // Retain failed CRON runs for investigation
};

export const draftExpirationQueue = new Queue(QUEUE_NAMES.DRAFT_EXPIRATION, {
  connection: redisConnection,
  prefix: BULL_PREFIX,
  defaultJobOptions: draftExpirationDefaultJobOptions,
});

// ─────────────────────────────────────────────────────────────
// voice-parse Queue — Phase 2.1
// Processes voice messages: download OGG → xAI Grok STT → enqueue ai-parse.
// Concurrency: 3 | xAI STT: $0.10/hr (well within $5 budget)
// SEC-12: No user text in payload (only file_id metadata).
// ─────────────────────────────────────────────────────────────

const voiceParseDefaultJobOptions: DefaultJobOptions = {
  attempts: 2,
  backoff: {
    type: 'fixed',
    delay: 3_000, // 3s — allow xAI STT to recover from transient errors
  },
  removeOnComplete: { count: 500 },
  // No raw_text in payload — no redaction needed, but still auto-remove after 24h
  removeOnFail: { age: 86_400 },
};

export const voiceParseQueue = new Queue<VoiceParseJobPayload>(
  QUEUE_NAMES.VOICE_PARSE,
  {
    connection: redisConnection,
    prefix: BULL_PREFIX,
    defaultJobOptions: voiceParseDefaultJobOptions,
  },
);

// ─────────────────────────────────────────────────────────────
// Graceful shutdown — close all queue connections
// ─────────────────────────────────────────────────────────────

export async function closeQueues(): Promise<void> {
  await Promise.all([
    webhookIngestionQueue.close(),
    aiParseQueue.close(),
    callbackConfirmQueue.close(),
    notificationsQueue.close(),
    draftExpirationQueue.close(),
    voiceParseQueue.close(),
  ]);
}


