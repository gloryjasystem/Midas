/**
 * webhook-ingestion Worker
 *
 * Processes jobs from the `webhook-ingestion` queue.
 * Concurrency: 10 (per queue_model.md)
 *
 * Responsibilities:
 *   1. Pre-Enqueue Guard chain validation (SEC-04, SEC-05, SEC-09)
 *      NOTE: SEC-04 (X-Telegram-Bot-Api-Secret-Token) is enforced by the
 *      HTTP server (telegram-bot app) BEFORE jobs are added to this queue.
 *      This worker only processes jobs that passed HTTP-layer validation.
 *   2. Message type check — non-text payloads must have been filtered upstream
 *      but this worker performs a defensive check (SEC-05)
 *   3. User-level rate limit check via Redis (SEC-09)
 *   4. Global AI budget guard (SEC-09)
 *   5. Enqueue ai-parse job with idempotency key (SEC-06)
 *   6. All DB operations use withTenantTransaction (SEC-03)
 *   7. Never log raw_text (SEC-12)
 *
 * Phase 1.3: Infrastructure skeleton.
 * AI parse call is delegated to ai-parse queue/worker.
 * Bot reply (notification) is delegated to notifications queue/worker.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, IdempotencyKeyBuilder, type WebhookIngestionJobPayload } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';
import { aiParseQueue } from '../queues/queue-definitions.js';
import type { AiParseJobPayload } from '@midas/shared';

// ─────────────────────────────────────────────────────────────
// Rate limit constants (SEC-09)
// ─────────────────────────────────────────────────────────────
const RATE_LIMIT_MAX_MESSAGES = 5;
const RATE_LIMIT_WINDOW_SECONDS = 10;
const AI_BUDGET_DAILY_KEY = 'ai_budget:daily';
// AI_BUDGET_MAX_DAILY_TOKENS is an operational config count (token budget), NOT a financial amount.
// parseInt is intentional here — this is not financial arithmetic (SEC-02 applies to monetary values).
const AI_BUDGET_MAX_DAILY_TOKENS = parseInt(process.env.AI_BUDGET_MAX_DAILY_TOKENS ?? '500000', 10);

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processWebhookIngestion(
  job: Job<WebhookIngestionJobPayload>,
): Promise<void> {
  const { botId, chatId, messageId, telegramUserId, workspaceId, receivedAt } = job.data;
  // raw_text is present in job.data but NEVER logged (SEC-12)

  // ── SEC-05: Defensive message-type check ─────────────────
  // The HTTP layer (telegram-bot app) must filter non-text messages before
  // enqueuing. This is a defensive backstop only.
  if (!job.data.raw_text || job.data.raw_text.trim().length === 0) {
    console.warn('[midas:webhook-worker] Empty raw_text — skipping job', {
      jobId: job.id,
      workspaceId,
      telegramUserId,
    });
    return; // Job completes successfully (no retry needed for empty input)
  }

  // ── SEC-09: User-level rate limit (Redis) ─────────────────
  const rateLimitKey = `rl:${telegramUserId}`;
  const msgCount = await redisConnection.incr(rateLimitKey);
  if (msgCount === 1) {
    // Set TTL only on first increment to avoid TTL reset on each message
    await redisConnection.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
  }
  if (msgCount > RATE_LIMIT_MAX_MESSAGES) {
    // Rate limit exceeded — job completes (no retry), bot should reply to user
    // The reply is sent via notifications queue
    console.warn('[midas:webhook-worker] Rate limit exceeded', {
      jobId: job.id,
      workspaceId,
      telegramUserId,
      msgCount,
    });
    // TODO Phase 1.4: enqueue notification "Слишком много сообщений, подождите."
    return;
  }

  // ── SEC-09: Global AI budget guard ───────────────────────
  // parseInt is safe here — dailyTokens is an operational count, not a financial amount (SEC-02)
  const dailyTokens = parseInt((await redisConnection.get(AI_BUDGET_DAILY_KEY)) ?? '0', 10);
  if (dailyTokens >= AI_BUDGET_MAX_DAILY_TOKENS) {
    console.warn('[midas:webhook-worker] Global AI budget exceeded', {
      jobId: job.id,
      workspaceId,
      dailyTokens,
    });
    // TODO Phase 1.4: enqueue notification "Сервис временно ограничен."
    return;
  }

  // ── Enqueue ai-parse job (SEC-06 idempotency key) ─────────
  const aiParseJobId = IdempotencyKeyBuilder.aiParse(botId, messageId);
  const aiParsePayload: AiParseJobPayload = {
    botId,
    messageId,
    chatId,
    telegramUserId,
    workspaceId,
    raw_text: job.data.raw_text, // passed through, not logged
    receivedAt,
  };

  await aiParseQueue.add(QUEUE_NAMES.AI_PARSE, aiParsePayload, {
    jobId: aiParseJobId,
    // Inherit retry config from queue defaultJobOptions
  });

  console.log('[midas:webhook-worker] Enqueued ai-parse job', {
    jobId: job.id,
    aiParseJobId,
    workspaceId,
    telegramUserId,
    // raw_text deliberately excluded (SEC-12)
  });
}

// ─────────────────────────────────────────────────────────────
// Worker instantiation
// ─────────────────────────────────────────────────────────────

export function createWebhookIngestionWorker(): Worker<WebhookIngestionJobPayload> {
  const worker = new Worker<WebhookIngestionJobPayload>(
    QUEUE_NAMES.WEBHOOK_INGESTION,
    processWebhookIngestion,
    {
      connection: redisConnection,
      prefix: 'bull',
      concurrency: 10,
    },
  );

  worker.on('completed', (job: Job<WebhookIngestionJobPayload>) => {
    console.log('[midas:webhook-worker] Job completed', {
      jobId: job.id,
      workspaceId: job.data.workspaceId,
    });
  });

  worker.on('failed', (job: Job<WebhookIngestionJobPayload> | undefined, err: Error) => {
    console.error('[midas:webhook-worker] Job failed', {
      jobId: job?.id ?? 'unknown',
      workspaceId: job?.data.workspaceId,
      errorClass: err.constructor.name,
    });
  });

  return worker;
}
