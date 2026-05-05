/**
 * ai-parse Worker — Phase 1.6-A
 *
 * Processes jobs from the `ai-parse` queue.
 * Concurrency: 5 (per queue_model.md)
 *
 * Flow:
 *   1. Resolve userId from telegramUserId via DB (SEC-03)
 *   2. Call parseTransaction(raw_text) — Claude Haiku + Zod validation (SEC-01)
 *   3. Track token usage in Redis (SEC-09, date-scoped key)
 *   4. Create TransactionDraft via withTenantTransaction (SEC-03)
 *   5. On final failure: sanitize raw_text in job payload (SEC-12)
 *
 * SEC-12 raw_text handling:
 *   - raw_text IS present in job.data (approved internal transit)
 *   - raw_text is NEVER logged in console.log/warn/error
 *   - raw_text is NEVER included in audit_logs, DLQ metadata, or Sentry
 *   - On final failure: job.updateData() redacts raw_text → '[REDACTED]'
 *   - Queue uses removeOnFail: { age: 86400 } (see queue-definitions.ts)
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type AiParseJobPayload, IdempotencyKeyBuilder } from '@midas/shared';
import { parseTransaction } from '@midas/ai-core';
import { redisConnection } from '../queues/redis.js';
import { createDraft, resolveUserId } from '../services/draft.service.js';
import { notificationsQueue } from '../queues/queue-definitions.js';
import { ulid } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Token budget (SEC-09, date-scoped)
// ─────────────────────────────────────────────────────────────

// parseInt is safe here: token count is operational metric, not financial (SEC-02)
const AI_BUDGET_MAX_DAILY_TOKENS = parseInt(
  process.env.AI_BUDGET_MAX_DAILY_TOKENS ?? '500000',
  10,
);

/** Date-scoped Redis key — auto-rotates daily without a CRON (SEC-09) */
function aiDailyBudgetKey(): string {
  return `ai_budget:${new Date().toISOString().slice(0, 10)}`; // YYYY-MM-DD
}

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processAiParse(job: Job<AiParseJobPayload>): Promise<void> {
  const { botId, workspaceId, telegramUserId, messageId } = job.data;
  // raw_text is in job.data — NEVER logged (SEC-12)

  console.log('[midas:ai-parse-worker] Processing job', {
    jobId: job.id,
    workspaceId,
    telegramUserId,
    messageId,
    // raw_text deliberately excluded (SEC-12)
  });

  // ── Step 1: Check AI daily budget (SEC-09) ────────────────
  const budgetKey = aiDailyBudgetKey();
  // parseInt is safe: operational count, not financial (SEC-02)
  const dailyTokens = parseInt(
    (await redisConnection.get(budgetKey)) ?? '0',
    10,
  );
  if (dailyTokens >= AI_BUDGET_MAX_DAILY_TOKENS) {
    console.warn('[midas:ai-parse-worker] Daily AI token budget exceeded', {
      jobId: job.id,
      workspaceId,
      dailyTokens,
      budgetKey,
    });
    // Fail the job — will be retried only if budget resets (new day)
    throw new Error(`AI daily token budget exceeded: ${String(dailyTokens)} >= ${String(AI_BUDGET_MAX_DAILY_TOKENS)}`);
  }

  // ── Step 2: Resolve internal userId ───────────────────────
  // Throws if user not found (onboarding must have succeeded first)
  let userId: string;
  try {
    userId = await resolveUserId(telegramUserId);
  } catch (err: unknown) {
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[midas:ai-parse-worker] User not found for telegramUserId', {
      jobId: job.id,
      workspaceId,
      errorClass,
      // telegramUserId excluded — maps to user PII
    });
    throw err;
  }

  // ── Step 3: Parse with Claude Haiku (SEC-01) ─────────────
  // raw_text passed to parseTransaction only — never logged inside
  const parseResult = await parseTransaction(job.data.raw_text);

  console.log('[midas:ai-parse-worker] Parse result', {
    jobId: job.id,
    workspaceId,
    status: parseResult.status,
    tokensUsed: parseResult.tokensUsed,
    // raw_text and parse output values deliberately excluded (SEC-12)
  });

  // ── Step 4: Track token usage (SEC-09, date-scoped) ──────
  await redisConnection.incrby(budgetKey, parseResult.tokensUsed);
  // Set TTL on first write: 48h so key survives across day boundaries
  await redisConnection.expire(budgetKey, 48 * 60 * 60, 'NX');

  // ── Step 5: Create TransactionDraft (SEC-03) ─────────────
  const telegramMessageId = parseInt(messageId, 10);
  if (isNaN(telegramMessageId)) {
    throw new Error(`Invalid messageId: ${messageId}`);
  }

  const { draftId, status } = await createDraft({
    workspaceId,
    userId,
    telegramMessageId,
    rawText: job.data.raw_text, // Stored in DB column, not logged (SEC-12)
    parseResult,
  });

  console.log('[midas:ai-parse-worker] Draft created', {
    jobId: job.id,
    workspaceId,
    draftId,
    status,
    botId,
  });

  // ── Step 6: Send draft confirmation notification (Phase 1.6-B) ──
  // Only send inline keyboard for drafts awaiting user confirmation.
  if (status === 'pending_user') {
    const { chatId } = job.data;
    const alertId = ulid();

    // Build inline keyboard for approve / reject
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Подтвердить', callback_data: `approve:${draftId}` },
          { text: '❌ Отклонить', callback_data: `reject:${draftId}` },
        ],
      ],
    };

    // Draft preview — note: do NOT include raw_text or amount in log (SEC-12)
    const previewMsg = `📝 Транзакция распознана. Подтвердите или отклоните:`;

    await notificationsQueue.add(
      QUEUE_NAMES.NOTIFICATIONS,
      {
        alertId,
        workspaceId,
        chatId,
        message: previewMsg,
        draftId,
        inlineKeyboardJson: JSON.stringify(inlineKeyboard),
      },
      {
        jobId: IdempotencyKeyBuilder.notification(workspaceId, alertId),
      },
    );

    console.log('[midas:ai-parse-worker] Confirmation notification enqueued', {
      jobId: job.id,
      draftId,
      workspaceId,
    });
  } else {
    // needs_clarification — send simple message, no keyboard
    const { chatId } = job.data;
    const alertId = ulid();
    await notificationsQueue.add(
      QUEUE_NAMES.NOTIFICATIONS,
      {
        alertId,
        workspaceId,
        chatId,
        message: '🤔 Не удалось распознать транзакцию. Попробуйте сформулировать иначе.',
      },
      { jobId: IdempotencyKeyBuilder.notification(workspaceId, alertId) },
    );
  }
}

// ─────────────────────────────────────────────────────────────
// SEC-12: Sanitize raw_text in failed job payload
// BullMQ v5 provides job.updateData() to replace job.data in Redis.
// Called from worker 'failed' event ONLY on final failure (no more retries).
// ─────────────────────────────────────────────────────────────

async function sanitizeFailedJobPayload(
  job: Job<AiParseJobPayload> | undefined,
): Promise<void> {
  if (!job) return;

  // Only sanitize on final failure (no more attempts left)
  const maxAttempts = job.opts.attempts ?? 1;
  const isFinalFailure = job.attemptsMade >= maxAttempts;
  if (!isFinalFailure) return;

  try {
    // Replace raw_text with redaction marker — removes PII from Redis-persisted payload
    await job.updateData({
      ...job.data,
      raw_text: '[REDACTED]', // SEC-12: no user text in failed job storage
    });
    console.log('[midas:ai-parse-worker] Sensitive field redacted in permanently failed job', {
      jobId: job.id,
      workspaceId: job.data.workspaceId,
    });
  } catch (sanitizeErr) {
    // Non-fatal: log sanitization failure but don't rethrow
    // (the original failure is already recorded)
    const errClass =
      sanitizeErr instanceof Error ? sanitizeErr.constructor.name : 'UnknownError';
    console.error('[midas:ai-parse-worker] Failed to sanitize job payload', {
      jobId: job.id,
      errorClass: errClass,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Worker instantiation
// ─────────────────────────────────────────────────────────────

export function createAiParseWorker(): Worker<AiParseJobPayload> {
  const worker = new Worker<AiParseJobPayload>(
    QUEUE_NAMES.AI_PARSE,
    processAiParse,
    {
      connection: redisConnection,
      prefix: 'bull',
      concurrency: 5,
      // BullMQ built-in rate limiting: 50 jobs per 60s window (Claude API tier)
      limiter: {
        max: 50,
        duration: 60_000,
      },
    },
  );

  worker.on('completed', (job: Job<AiParseJobPayload>) => {
    console.log('[midas:ai-parse-worker] Job completed', {
      jobId: job.id,
      workspaceId: job.data.workspaceId,
    });
  });

  worker.on('failed', (job: Job<AiParseJobPayload> | undefined, err: Error) => {
    // Log only safe fields (SEC-12)
    console.error('[midas:ai-parse-worker] Job failed', {
      jobId: job?.id ?? 'unknown',
      workspaceId: job?.data.workspaceId,
      errorClass: err.constructor.name,
      attemptsMade: job?.attemptsMade,
      // raw_text deliberately excluded (SEC-12)
    });

    // SEC-12: Sanitize raw_text on final failure (fire-and-forget, non-blocking)
    sanitizeFailedJobPayload(job).catch((sanitizeErr: unknown) => {
      const errClass =
        sanitizeErr instanceof Error ? sanitizeErr.constructor.name : 'UnknownError';
      console.error('[midas:ai-parse-worker] Sanitize catch', { errorClass: errClass });
    });
  });

  return worker;
}
