/**
 * ai-parse Worker — Phase 1.6-A / Phase 1.31 / Phase 1.32
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
 * Phase 1.32 additions:
 *   - 'partial' ParseResult: creates needs_clarification draft with clarification_field set.
 *   - Sends targeted clarification message instead of generic "не понял":
 *     - missing amount  → text question "Сколько потратил?"
 *     - missing intent  → 2-button intent picker keyboard
 *     - missing category → category picker keyboard (fetched from DB)
 *   - Nonsense (confidence < 0.3) → shortcut buttons keyboard.
 *   - All clarification keyboards use 'clar:' callback namespace (≤62 bytes).
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
import { createDraft, resolveUserId, setDraftAccountId } from '../services/draft.service.js';
import { resolveAccountFromHint } from '../services/account-resolver.service.js'; // Phase 1.31
import { notificationsQueue } from '../queues/queue-definitions.js';
import { ulid } from 'ulid';
import { pool } from '@midas/database';
import {
  buildPreviewScreen,
  buildClarificationScreen,
  buildNonsenseScreen,
  buildConfirmKeyboard,
  escapeHtml,
} from '../utils/screen-builder.js';

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
// Clarification keyboard helpers — Phase 1.32
// ─────────────────────────────────────────────────────────────

/**
 * Build the intent clarification keyboard for unclear intent.
 * callback_data format: clar:intent:{value}:{draftId}
 * Max bytes: "clar:intent:debt_received:" (26) + ULID(26) = 52 bytes ✅
 */
function buildIntentClarKeyboard(draftId: string, currentIntent?: string | null): object {
  // Show the most likely pair based on what AI guessed (or show all 4 non-transfer)
  if (currentIntent === 'debt_given' || currentIntent === 'debt_received') {
    return {
      inline_keyboard: [
        [
          { text: '🤝 Дал в долг', callback_data: `clar:intent:debt_given:${draftId}` },
          { text: '💸 Просто расход', callback_data: `clar:intent:expense:${draftId}` },
        ],
        [
          { text: '🤲 Взял в долг', callback_data: `clar:intent:debt_received:${draftId}` },
          { text: '💰 Доход', callback_data: `clar:intent:income:${draftId}` },
        ],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: '💸 Расход', callback_data: `clar:intent:expense:${draftId}` },
        { text: '💰 Доход', callback_data: `clar:intent:income:${draftId}` },
      ],
      [
        { text: '🤝 Долг (дал)', callback_data: `clar:intent:debt_given:${draftId}` },
        { text: '🤲 Долг (взял)', callback_data: `clar:intent:debt_received:${draftId}` },
      ],
    ],
  };
}

/**
 * Build the category clarification keyboard.
 * Shows first 6 workspace categories + "Без категории" button.
 * callback_data: clar:cat:{catId}:{draftId} — max 5+4+26+1+26 = 62 bytes ✅
 * callback_data: clar:nocat:{draftId} — max 5+6+26 = 37 bytes ✅
 */
function buildCategoryClarKeyboard(
  categories: { id: string; name: string }[],
  draftId: string,
): object {
  const top6 = categories.slice(0, 6);
  const rows: { text: string; callback_data: string }[][] = [];

  // 2 per row
  for (let i = 0; i < top6.length; i += 2) {
    const row = [
      { text: top6[i]?.name ?? '', callback_data: `clar:cat:${top6[i]?.id ?? ''}:${draftId}` },
    ];
    if (top6[i + 1]) {
      row.push({ text: top6[i + 1]?.name ?? '', callback_data: `clar:cat:${top6[i + 1]?.id ?? ''}:${draftId}` });
    }
    rows.push(row);
  }

  rows.push([{ text: '📋 Без категории', callback_data: `clar:nocat:${draftId}` }]);

  return { inline_keyboard: rows };
}

/**
 * Build the nonsense keyboard.
 * Phase 1.37-UX: No inline buttons — AI should determine intent from context.
 * Returns an empty keyboard which clears any previously displayed buttons
 * when the message is edited (e.g., 2nd unrecognised message edits the 1st).
 */
function buildNonsenseKeyboard(_draftId: string): object {
  return { inline_keyboard: [] };
}

// ─────────────────────────────────────────────────────────────
// fetchWorkspaceCategories — Phase 1.32
// ─────────────────────────────────────────────────────────────

async function fetchWorkspaceCategories(
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  const result = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM categories
     WHERE workspace_id = $1 AND deleted_at IS NULL
     ORDER BY name ASC
     LIMIT 6`,
    [workspaceId],
  );
  return result.rows;
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

  const { draftId, status, clarificationField, partialData } = await createDraft({
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
    clarificationField,
  });

  const { chatId } = job.data;
  const alertId = ulid();

  // ── Step 6: Send response based on parse result ──────────
  if (status === 'pending_user') {
    // ── Phase 1.31 (Option A): Resolve account_hint BEFORE first keyboard ──
    const accountHint = parseResult.status === 'ok' ? (parseResult.data.account_hint ?? null) : null;

    let inlineKeyboard: object;
    let previewMsg: string;

    // Phase 1.34: Build rich preview card with all known fields
    const aiData = parseResult.status === 'ok' ? parseResult.data : null;
    const richPreview = buildPreviewScreen({
      intent: aiData?.intent ?? null,
      amount: aiData?.amount ?? null,
      currency: aiData?.currency ?? null,
      categoryHint: aiData?.category_hint ?? null,
      accountHint: accountHint,
      itemName: aiData?.item_hint ?? null,
    });

    if (accountHint) {
      let resolution;
      try {
        resolution = await resolveAccountFromHint(workspaceId, userId, accountHint);
      } catch {
        resolution = { kind: 'none' as const };
      }

      if (resolution.kind === 'exact') {
        try {
          await setDraftAccountId(workspaceId, userId, draftId, resolution.accountId);
        } catch {
          // Non-fatal: confirmation worker will fall back to default account
        }
        inlineKeyboard = buildConfirmKeyboard(draftId);
        previewMsg = richPreview;
        console.log('[midas:ai-parse-worker] Phase 1.31: exact account match', {
          workspaceId, draftId,
        });

      } else if (resolution.kind === 'fuzzy') {
        inlineKeyboard = {
          inline_keyboard: [
            [{ text: `✅ Да, «${escapeHtml(resolution.accountName)}»`, callback_data: `ia:fuzzy:${resolution.accountId}:${draftId}` }],
            [{ text: '🏦 Другой счёт', callback_data: `ia:skip:${draftId}` }],
          ],
        };
        previewMsg =
          richPreview + `\n\nСчёт «${escapeHtml(accountHint)}» не найден точно.\n` +
          `Возможно, имеется в виду <b>${escapeHtml(resolution.accountName)}</b>?`;
        console.log('[midas:ai-parse-worker] Phase 1.31: fuzzy account match', {
          workspaceId, draftId,
        });

      } else {
        const currency = parseResult.status === 'ok' ? (parseResult.data.currency ?? 'USDT') : 'USDT';
        inlineKeyboard = {
          inline_keyboard: [
            [{ text: `✅ Создать «${escapeHtml(accountHint)}» (${escapeHtml(currency)})`, callback_data: `ia:create:${draftId}` }],
            [{ text: '✏️ Другое название', callback_data: `ia:rename:${draftId}` }],
            [{ text: '📋 Записать без счёта', callback_data: `ia:skip:${draftId}` }],
          ],
        };
        previewMsg =
          richPreview + `\n\nСчёта <b>${escapeHtml(accountHint)}</b> нет в вашем списке.\n\n` +
          `Создать счёт <b>${escapeHtml(accountHint)}</b> (${escapeHtml(currency)})?`;
        console.log('[midas:ai-parse-worker] Phase 1.31: no account match, inline create offered', {
          workspaceId, draftId,
        });
      }
    } else {
      // No account_hint — standard approve/reject keyboard
      inlineKeyboard = buildConfirmKeyboard(draftId);
      previewMsg = richPreview;
    }

    // Phase 1.37-UX: Check if a previous "Не понял" card exists and should be deleted.
    // When AI successfully understands a new message, we delete the old clarification
    // card so only the new preview card remains in chat (clean, single-message UX).
    const clarMsgCacheKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
    let prevClarMsgIdForDelete: string | undefined;
    try {
      const stored = await redisConnection.get(clarMsgCacheKey);
      if (stored) {
        prevClarMsgIdForDelete = stored;
        // Clear immediately — next clarification will start fresh
        void redisConnection.del(clarMsgCacheKey);
      }
    } catch {
      prevClarMsgIdForDelete = undefined; // non-fatal
    }

    await notificationsQueue.add(
      QUEUE_NAMES.NOTIFICATIONS,
      {
        alertId,
        workspaceId,
        chatId,
        message: previewMsg,
        draftId,
        inlineKeyboardJson: JSON.stringify(inlineKeyboard),
        telegramUserId,
        deleteMessageId: prevClarMsgIdForDelete, // delete old "Не понял" before sending
        // NOTE: No activeMessageId — each preview card is a fresh message.
        // History of transaction cards accumulates in chat. (Phase 1.36-UX)
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
    // ── status === 'needs_clarification' ─────────────────────
    // Phase 1.32: targeted clarification if clarificationField is set,
    // nonsense shortcuts if not.

    let clarMsg: string;
    let clarKeyboard: object;

    if (clarificationField === 'amount') {
      // Missing amount — ask text question; set Redis intercept key
      // The Redis key is set here so the next text message is intercepted.
      // Key: midas:clar:{telegramUserId}:{chatId} → "{draftId}:amt"
      const clarKey = `midas:clar:${telegramUserId}:${chatId}`;
      await redisConnection.set(clarKey, `${draftId}:amt`, 'EX', 300);

      clarMsg = buildClarificationScreen({
        field: 'amount',
        intent: partialData?.intent ?? null,
        amount: null,
        currency: partialData?.currency ?? null,
        categoryHint: partialData?.category_hint ?? null,
      });
      // No keyboard for amount — user types a number
      clarKeyboard = { inline_keyboard: [] };

    } else if (clarificationField === 'intent') {
      // Unclear intent — show intent picker
      clarMsg = buildClarificationScreen({
        field: 'intent',
        intent: null,
        amount: partialData?.amount ?? null,
        currency: partialData?.currency ?? null,
        categoryHint: partialData?.category_hint ?? null,
      });
      clarKeyboard = buildIntentClarKeyboard(draftId, partialData?.intent ?? null);

    } else if (clarificationField === 'category') {
      // Missing category — show category picker
      let categories: { id: string; name: string }[];
      try {
        categories = await fetchWorkspaceCategories(workspaceId);
      } catch {
        categories = [];
      }
      if (categories.length === 0) {
        // No categories — fall back to nonsense keyboard (category clarification impossible)
        clarMsg = buildNonsenseScreen();
        clarKeyboard = buildNonsenseKeyboard(draftId);
      } else {
        clarMsg = buildClarificationScreen({
          field: 'category',
          intent: partialData?.intent ?? null,
          amount: partialData?.amount ?? null,
          currency: partialData?.currency ?? null,
          categoryHint: null,
        });
        clarKeyboard = buildCategoryClarKeyboard(categories, draftId);
      }

    } else {
      // No clarificationField — nonsense (confidence < 0.3)
      clarMsg = buildNonsenseScreen();
      clarKeyboard = buildNonsenseKeyboard(draftId);
    }

    // Phase 1.37-UX: Read previous clarification message ID from Redis.
    // If present, pass as activeMessageId so the notifications worker edits it
    // instead of sending a duplicate "Не понял" message.
    // Key is separate from midas:clar: (which is reserved for amount-intercept).
    const clarMsgCacheKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
    let prevClarMsgId: string | undefined;
    try {
      prevClarMsgId = (await redisConnection.get(clarMsgCacheKey)) ?? undefined;
    } catch {
      prevClarMsgId = undefined; // non-fatal: will send fresh message
    }

    await notificationsQueue.add(
      QUEUE_NAMES.NOTIFICATIONS,
      {
        alertId,
        workspaceId,
        chatId,
        message: clarMsg,
        draftId,
        inlineKeyboardJson: JSON.stringify(clarKeyboard),
        telegramUserId,
        activeMessageId: prevClarMsgId,       // edit prev clarification msg if exists
        cacheStoreKey: clarMsgCacheKey,       // worker writes sentMessageId here after send
      },
      {
        jobId: IdempotencyKeyBuilder.notification(workspaceId, alertId),
      },
    );

    console.log('[midas:ai-parse-worker] Clarification notification enqueued', {
      jobId: job.id,
      draftId,
      workspaceId,
      clarificationField,
    });
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
