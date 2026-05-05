/**
 * ai-parse Worker
 *
 * Processes jobs from the `ai-parse` queue.
 * Concurrency: 5 (per queue_model.md)
 *
 * Responsibilities:
 *   1. Call Claude Haiku API to parse raw_text into structured intent (Phase 1.4)
 *   2. Validate AI output against strict Zod allowlist (SEC-01)
 *      — AI output MUST NOT contain: id, user_id, workspace_id, tenant_id, status,
 *        category_id, person_id, exchange_rate, base_amount, draft_id, account_id
 *   3. System fields injected by controller only (SEC-01)
 *   4. All DB operations use withTenantTransaction (SEC-03)
 *   5. On success: create TransactionDraft with status 'pending_user'
 *   6. Enqueue notification job for user confirmation (Human-in-the-Loop)
 *   7. Track token usage for AI budget guard (SEC-09)
 *   8. Never log raw_text (SEC-12)
 *
 * Phase 1.3: Infrastructure skeleton only.
 * Claude API integration implemented in Phase 1.4 (AI Core).
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type AiParseJobPayload } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';

const AI_BUDGET_DAILY_KEY = 'ai_budget:daily';

async function processAiParse(
  job: Job<AiParseJobPayload>,
): Promise<void> {
  const { workspaceId, telegramUserId, messageId } = job.data;
  // raw_text is present in job.data but NEVER logged (SEC-12)

  console.log('[midas:ai-parse-worker] Processing job', {
    jobId: job.id,
    workspaceId,
    telegramUserId,
    messageId,
    // raw_text deliberately excluded (SEC-12)
  });

  // ── Phase 1.4 stub ────────────────────────────────────────
  // TODO Phase 1.4 (AI Core):
  //   1. Call parseTransactionWithClaude(job.data.raw_text)
  //   2. Validate result with AiOutputZodSchema (SEC-01)
  //   3. Inject system fields (workspace_id, user_id, draft_id via ULID)
  //   4. withTenantTransaction(workspaceId, async (client) => {
  //        await DraftRepository.create(client, draftData);
  //      });
  //   5. Track tokens: await redisConnection.incrby(AI_BUDGET_DAILY_KEY, tokensUsed);
  //   6. Enqueue notification with inline keyboard (Human-in-the-Loop)

  // Void reference to suppress unused import warning during skeleton phase
  void AI_BUDGET_DAILY_KEY;

  // Await a no-op to satisfy require-await lint rule during skeleton phase
  // This will be replaced with real async calls in Phase 1.4
  await Promise.resolve();

  console.log('[midas:ai-parse-worker] Phase 1.3 skeleton — AI integration pending (Phase 1.4)', {
    jobId: job.id,
    workspaceId,
  });
}

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
        duration: 60_000, // 60 seconds
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
    console.error('[midas:ai-parse-worker] Job failed', {
      jobId: job?.id ?? 'unknown',
      workspaceId: job?.data.workspaceId,
      errorClass: err.constructor.name,
    });
  });

  return worker;
}
