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
  attempts: 2,
  backoff: {
    type: 'fixed',
    delay: 5000, // 5s fixed — Claude API rate limit recovery
  },
  removeOnComplete: {
    count: 500,
  },
  removeOnFail: false,
};

export const aiParseQueue = new Queue<AiParseJobPayload>(QUEUE_NAMES.AI_PARSE, {
  connection: redisConnection,
  prefix: BULL_PREFIX,
  defaultJobOptions: aiParseDefaultJobOptions,
});

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
// Graceful shutdown — close all queue connections
// ─────────────────────────────────────────────────────────────

export async function closeQueues(): Promise<void> {
  await Promise.all([
    webhookIngestionQueue.close(),
    aiParseQueue.close(),
    notificationsQueue.close(),
  ]);
}
