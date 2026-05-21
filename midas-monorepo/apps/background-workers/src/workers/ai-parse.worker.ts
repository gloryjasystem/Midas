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
import { createDraft, resolveUserId, setDraftAccountId, getPendingDraftForUser, getAccountBalanceForPreview, getWorkspaceAccountNames, getWorkspaceAccountsForPicker, type WorkspaceAccountEntry } from '../services/draft.service.js';
import { resolveAccountFromHint } from '../services/account-resolver.service.js'; // Phase 1.31
import { notificationsQueue } from '../queues/queue-definitions.js';
import { ulid } from 'ulid';
import { pool, withTenantTransaction } from '@midas/database';
import {
  buildPreviewScreen,
  buildClarificationScreen,
  buildNonsenseScreen,
  buildConfirmKeyboard,
  buildCurrencyClarScreen,
  escapeHtml,
  type AccountBalanceBlock,
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
function buildNonsenseKeyboard(): object {
  return { inline_keyboard: [] };
}

// ─────────────────────────────────────────────────────────────
// Currency-aware picker filtering
// ─────────────────────────────────────────────────────────────

/**
 * Filter picker accounts by transaction currency — STRICT exact match.
 * "100 EUR" → only EUR accounts. "1000 USDT" → only USDT accounts.
 * "0.5 BTC" → only BTC accounts. "5000 UAH" → only UAH accounts.
 *
 * No cross-currency fallback: if the user has no accounts in the
 * transaction currency, the picker shows an empty-state with a
 * "Create account" button instead of irrelevant accounts.
 */
function filterPickerAccounts(
  accounts: WorkspaceAccountEntry[],
  txCurrency: string,
): WorkspaceAccountEntry[] {
  const txCur = txCurrency.toUpperCase();
  return accounts.filter((a) => a.currency.toUpperCase() === txCur);
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

  const { chatId } = job.data;

  // ── Step 2.4: Phase 1.39 — Auto-delete expired draft cards ────
  // When user sends a new message, clean up any previously expired
  // draft cards from the chat (kept in Redis for 24h).
  try {
    const expiredKey = `midas:expired_msgs:${chatId}`;
    const expiredMsgIds = await redisConnection.get(expiredKey);
    if (expiredMsgIds) {
      const ids = expiredMsgIds.split(',').filter(Boolean);
      for (const msgId of ids) {
        const delAlertId = ulid();
        await notificationsQueue.add(
          QUEUE_NAMES.NOTIFICATIONS,
          {
            alertId: delAlertId,
            workspaceId,
            chatId,
            message: '',
            deleteMessageId: msgId,
          },
          { jobId: IdempotencyKeyBuilder.notification(workspaceId, delAlertId) },
        );
      }
      void redisConnection.del(expiredKey);
    }
  } catch { /* non-fatal expired cleanup */ }

  // ── Step 2.5: Phase 1.39 — Active draft gate check ──────────
  // Gate only blocks when a pending_user draft exists (full preview shown).
  // needs_clarification drafts are NOT gated — user input is expected.
  const pendingDraft = await getPendingDraftForUser(workspaceId, userId);
  if (pendingDraft) {
    const gateSentKey = `midas:gate_sent:${telegramUserId}:${chatId}`;
    const alreadySent = await redisConnection.get(gateSentKey);

    if (!alreadySent) {
      // Single edit-in-place: update existing preview card with alert banner + keyboard.
      // No new messages sent — zero chat clutter.
      let accountBlock: AccountBalanceBlock | null = null;
      let accountForKb: { id: string; name: string; currency: string } | null = null;
      let xfxForKb: { hasCrossAmount: boolean } | null = null;

      if (pendingDraft.accountId) {
        const acctData = await getAccountBalanceForPreview(workspaceId, pendingDraft.accountId);
        if (acctData) {
          accountForKb = { id: acctData.accountId, name: acctData.accountName, currency: acctData.accountCurrency };
          const isCrossCurrency = !!pendingDraft.parsedCurrency && acctData.accountCurrency !== pendingDraft.parsedCurrency;
          const hasCrossAmount = !!pendingDraft.accountDebitAmount;
          xfxForKb = isCrossCurrency ? { hasCrossAmount } : null;

          const debitAmount = isCrossCurrency ? pendingDraft.accountDebitAmount : pendingDraft.parsedAmount;

          accountBlock = {
            accountName: escapeHtml(acctData.accountName),
            accountCurrency: acctData.accountCurrency,
            currentBalance: acctData.balance,
            debitAmount: debitAmount,
            debitCurrency: acctData.accountCurrency,
            txAmount: pendingDraft.parsedAmount ?? '0',
            txCurrency: pendingDraft.parsedCurrency ?? 'USD',
            intent: pendingDraft.parsedIntent,
          };
        }
      }

      const gateMessageText = buildPreviewScreen({
        intent: pendingDraft.parsedIntent,
        amount: pendingDraft.parsedAmount,
        currency: pendingDraft.parsedCurrency,
        categoryHint: pendingDraft.parsedCategoryHint ? escapeHtml(pendingDraft.parsedCategoryHint) : null,
        accountHint: null,
        itemName: pendingDraft.itemName ? escapeHtml(pendingDraft.itemName) : null,
        accountBlock,
        gateAlert: '⚠️ <b>Новая запись отклонена.</b>\nЗавершите эту транзакцию, чтобы продолжить.',
      });

      // Phase 2.10+: Choose the right keyboard for the gate message.
      // If no account was selected yet (user was on account picker), rebuild the picker.
      // If account is already linked, show confirm keyboard.
      let gateInlineKeyboard: object;
      let gateFinalMessage = gateMessageText;

      if (!pendingDraft.accountId) {
        // Draft has no account — user was looking at account picker. Restore it.
        // Phase 2.5: apply same currency-aware filtering as the initial picker.
        let pickerAccountsGate: WorkspaceAccountEntry[] = [];
        try {
          const allGateAccounts = await getWorkspaceAccountsForPicker(workspaceId);
          const gateCur = pendingDraft.parsedCurrency ?? null;
          pickerAccountsGate = gateCur
            ? filterPickerAccounts(allGateAccounts, gateCur)
            : allGateAccounts;
        } catch {
          pickerAccountsGate = [];
        }
        if (pickerAccountsGate.length > 0) {
          const intentGate = pendingDraft.parsedIntent;
          const pickerHeaderGate = (intentGate === 'income' || intentGate === 'debt_received')
            ? '\uD83C\uDFE6 <b>\u041D\u0430 \u043A\u0430\u043A\u043E\u0439 \u0441\u0447\u0451\u0442 \u0437\u0430\u0447\u0438\u0441\u043B\u0438\u0442\u044C?</b>'
            : '\uD83C\uDFE6 <b>\u0421 \u043A\u0430\u043A\u043E\u0433\u043e \u0441\u0447\u0451\u0442\u0430 \u0441\u043F\u0438\u0441\u0430\u0442\u044C?</b>';
          const pickerRowsGate = pickerAccountsGate.slice(0, 8).map((acc) => {
            const balDisplay = acc.balance.replace(/\.?0+$/, '') || '0';
            return [{ text: `\uD83C\uDFE6 ${acc.name} \u00B7 ${balDisplay} ${acc.currency}`, callback_data: `ia:pk:${acc.id}:${pendingDraft.draftId}` }];
          });
          pickerRowsGate.push([{ text: '\u2795 \u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0441\u0447\u0451\u0442', callback_data: `ia:newac:${pendingDraft.draftId}` }]);
          pickerRowsGate.push([{ text: '\u2716\uFE0F \u041E\u0442\u043C\u0435\u043D\u0430', callback_data: `ia:cancel:${pendingDraft.draftId}` }]);
          gateInlineKeyboard = { inline_keyboard: pickerRowsGate };
          gateFinalMessage = gateMessageText + '\n\n' + pickerHeaderGate;
        } else {
          gateInlineKeyboard = buildConfirmKeyboard(pendingDraft.draftId, null, null);
        }
      } else {
        gateInlineKeyboard = buildConfirmKeyboard(pendingDraft.draftId, accountForKb, xfxForKb);
      }

      // Send gate notification: edit-in-place if previewMessageId known, else send new.
      // telegramUserId included so notifications.worker updates midas:am: pointer.
      const gateEditId = ulid();
      await notificationsQueue.add(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          alertId: gateEditId,
          workspaceId,
          chatId: pendingDraft.previewChatId ?? chatId,
          draftId: pendingDraft.draftId,
          telegramUserId,
          message: gateFinalMessage,
          activeMessageId: pendingDraft.previewMessageId ?? undefined,
          inlineKeyboardJson: JSON.stringify(gateInlineKeyboard),
        },
        { jobId: IdempotencyKeyBuilder.notification(workspaceId, gateEditId) },
      );

      await redisConnection.set(gateSentKey, '1', 'EX', 3600);
    }
    // else: gate already sent — silently ignore

    // ── Delete the "⏳ Распознаю голосовое..." status message ──
    // When the new input came from a voice message, voice-parse.worker
    // stored the status message ID in midas:clar:msg so ai-parse can
    // clean it up. On the gate path we must do this explicitly since
    // we return early before the normal clarification/preview flow.
    try {
      const clarMsgKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
      const voiceStatusMsgId = await redisConnection.get(clarMsgKey);
      if (voiceStatusMsgId) {
        const delAlertId = ulid();
        await notificationsQueue.add(
          QUEUE_NAMES.NOTIFICATIONS,
          {
            alertId: delAlertId,
            workspaceId,
            chatId,
            message: '',
            deleteMessageId: voiceStatusMsgId,
          },
          { jobId: IdempotencyKeyBuilder.notification(workspaceId, delAlertId) },
        );
        void redisConnection.del(clarMsgKey);
      }
    } catch { /* non-fatal: status msg stays but gate still works */ }

    // Phase 1.40: Also delete stale "❌ Отменено" / "⏰ Черновик истёк" dead card on gate path.
    try {
      const gateDeadCardKey = `midas:dead_card:${chatId}`;
      const gateDeadCardMsgId = await redisConnection.get(gateDeadCardKey);
      if (gateDeadCardMsgId) {
        const delDeadAlertId = ulid();
        await notificationsQueue.add(
          QUEUE_NAMES.NOTIFICATIONS,
          {
            alertId: delDeadAlertId,
            workspaceId,
            chatId,
            message: '',
            deleteMessageId: gateDeadCardMsgId,
          },
          { jobId: IdempotencyKeyBuilder.notification(workspaceId, delDeadAlertId) },
        );
        void redisConnection.del(gateDeadCardKey);
      }
    } catch { /* non-fatal */ }

    console.log('[midas:ai-parse-worker] Gate: blocked new input, active draft exists', {
      jobId: job.id,
      workspaceId,
      activeDraftId: pendingDraft.draftId,
      activeDraftStatus: pendingDraft.status,
    });
    return; // ← STOP — do not process new message
  }

  // ── Step 3: Parse with Claude Haiku (SEC-01) ─────────────
  // raw_text passed to parseTransaction only — never logged inside
  // Phase 2.4 PR17: fetch workspace account names for AI context (non-blocking)
  let accountNames: string[] = [];
  try {
    accountNames = await getWorkspaceAccountNames(workspaceId);
  } catch {
    // Non-fatal: AI parses without account context, balance block shows after picker
    accountNames = [];
  }
  const parseResult = await parseTransaction(job.data.raw_text, accountNames);

  console.log('[midas:ai-parse-worker] Parse result', {
    jobId: job.id,
    workspaceId,
    status: parseResult.status,
    tokensUsed: parseResult.tokensUsed,
    accountNamesCount: accountNames.length, // safe to log (count only, not names)
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


  const alertId = ulid();

  // ── Step 6: Send response based on parse result ──────────
  if (status === 'pending_user') {
    // ── Phase 1.38 / Phase 9: Currency & primary-account resolution ──────────
    // If AI didn't extract a currency, try to auto-resolve without asking user.
    const aiCurrency = partialData?.currency ?? null;
    if (!aiCurrency) {
      // Phase 9: use getWorkspaceAccountsForPicker (no RLS issues) to find ⭐ primary account.
      let primaryAccount: { id: string; name: string; currency: string } | null = null;
      try {
        const allAccounts = await getWorkspaceAccountsForPicker(workspaceId);
        const primary = allAccounts.find((a) => a.is_expense_default === true);
        if (primary) primaryAccount = { id: primary.id, name: primary.name, currency: primary.currency };
      } catch { /* non-fatal */ }

      if (primaryAccount) {
        // Auto-apply: patch currency + account_id on draft (RLS-safe via withTenantTransaction)
        try {
          await setDraftAccountId(workspaceId, userId, draftId, primaryAccount.id);
        } catch { /* non-fatal */ }
        try {
          await withTenantTransaction(workspaceId, userId, async (client) => {
            await client.query(
              `UPDATE transaction_drafts SET parsed_currency = $3, updated_at = NOW()
                WHERE id = $2 AND workspace_id = $1`,
              [workspaceId, draftId, primaryAccount!.currency],
            );
          });
        } catch { /* non-fatal */ }

        // Build confirm card with primary account balance
        const aiData9 = parseResult.status === 'ok' ? parseResult.data : null;
        let accountBlock9: AccountBalanceBlock | null = null;
        let accountForKb9: { id: string; name: string; currency: string } | null = null;
        try {
          const acctData9 = await getAccountBalanceForPreview(workspaceId, primaryAccount.id);
          if (acctData9) {
            accountForKb9 = { id: acctData9.accountId, name: acctData9.accountName, currency: acctData9.accountCurrency };
            accountBlock9 = {
              accountName:     escapeHtml(acctData9.accountName),
              accountCurrency: acctData9.accountCurrency,
              currentBalance:  acctData9.balance,
              debitAmount:     aiData9?.amount ?? null,
              debitCurrency:   acctData9.accountCurrency,
              txAmount:        aiData9?.amount ?? '0',
              txCurrency:      primaryAccount!.currency,
              intent:          aiData9?.intent ?? null,
            };
          }
        } catch { /* non-fatal */ }

        const previewWithPrimary = buildPreviewScreen({
          intent:       aiData9?.intent ?? null,
          amount:       aiData9?.amount ?? null,
          currency:     primaryAccount.currency,
          categoryHint: aiData9?.category_hint ?? null,
          accountHint:  null,
          itemName:     aiData9?.item_hint ?? null,
          accountBlock: accountBlock9,
        });

        // Delete stale clarification card if any
        let msgToDelete9: string | undefined;
        try {
          const storedClarKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
          const stored9 = await redisConnection.get(storedClarKey);
          if (stored9) { msgToDelete9 = stored9; void redisConnection.del(storedClarKey); }
        } catch { /* non-fatal */ }

        await notificationsQueue.add(
          QUEUE_NAMES.NOTIFICATIONS,
          {
            alertId, workspaceId, chatId, message: previewWithPrimary, draftId,
            inlineKeyboardJson: JSON.stringify(buildConfirmKeyboard(draftId, accountForKb9, null)),
            telegramUserId, deleteMessageId: msgToDelete9,
          },
          { jobId: IdempotencyKeyBuilder.notification(workspaceId, alertId) },
        );

        console.log('[midas:ai-parse-worker] Phase 9: primary account auto-selected, confirm sent', {
          jobId: job.id, draftId, workspaceId,
        });
        return; // ← skip all remaining flow
      }

      // No primary account — check Redis cur_set flag (currency set in Settings)
      const curSetFlag = await redisConnection.exists(`midas:cur_set:${workspaceId}`);
      if (curSetFlag === 0) {
        const awaitKey = `midas:awaiting_cur:${chatId}`;
        await redisConnection.set(awaitKey, `${draftId}:${workspaceId}:${userId}`, 'EX', 600);

        const clarMsg = buildCurrencyClarScreen();
        const clarMsgCacheKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
        let prevClarMsgId: string | undefined;
        try { prevClarMsgId = (await redisConnection.get(clarMsgCacheKey)) ?? undefined; } catch { prevClarMsgId = undefined; }

        await notificationsQueue.add(
          QUEUE_NAMES.NOTIFICATIONS,
          {
            alertId, workspaceId, chatId, draftId, telegramUserId,
            message: clarMsg,
            inlineKeyboardJson: JSON.stringify({ inline_keyboard: [] }),
            activeMessageId: prevClarMsgId,
            cacheStoreKey: clarMsgCacheKey,
          },
          { jobId: IdempotencyKeyBuilder.notification(workspaceId, alertId) },
        );

        console.log('[midas:ai-parse-worker] Phase 1.38: currency clarification sent', {
          jobId: job.id, draftId, workspaceId,
        });
        return;
      }
      // curSetFlag === 1 → fall through to normal confirm card
    } // end if (!aiCurrency)


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

        // Phase 2.4 PR15: Fetch account balance for preview card
        let accountBlock: AccountBalanceBlock | null = null;
        let accountForKb: { id: string; name: string; currency: string } | null = null;
        let xfxForKb: { hasCrossAmount: boolean } | null = null;

        try {
          const acctData = await getAccountBalanceForPreview(workspaceId, resolution.accountId);
          if (acctData && aiData?.amount) {
            accountForKb = { id: acctData.accountId, name: acctData.accountName, currency: acctData.accountCurrency };
            const isCrossCurrency = !!aiData.currency && acctData.accountCurrency !== aiData.currency;
            xfxForKb = isCrossCurrency ? { hasCrossAmount: false } : null;

            // Debit amount in account currency:
            // For same-currency: use tx amount; for XFX: we don't know yet at parse time
            const isSameCurrency = !aiData.currency || aiData.currency === acctData.accountCurrency;
            accountBlock = {
              accountName:     escapeHtml(acctData.accountName),
              accountCurrency: acctData.accountCurrency,
              currentBalance:  acctData.balance,
              debitAmount:     isSameCurrency ? aiData.amount : null,
              debitCurrency:   isSameCurrency ? acctData.accountCurrency : (aiData.currency ?? acctData.accountCurrency),
              txAmount:        aiData.amount,
              txCurrency:      aiData.currency ?? 'USD',
              intent:          aiData?.intent ?? null,
            };
          }
        } catch {
          // Non-fatal: preview shows without balance block
        }

        const richPreviewWithBalance = buildPreviewScreen({
          intent:       aiData?.intent ?? null,
          amount:       aiData?.amount ?? null,
          currency:     aiData?.currency ?? null,
          categoryHint: aiData?.category_hint ?? null,
          accountHint:  null, // accountBlock replaces accountHint
          itemName:     aiData?.item_hint ?? null,
          accountBlock,
        });

        inlineKeyboard = buildConfirmKeyboard(draftId, accountForKb, xfxForKb);
        previewMsg = richPreviewWithBalance;
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
            [{ text: '✖️ Отмена', callback_data: `ia:cancel:${draftId}` }],
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
      // No account_hint from AI — show account picker if workspace has accounts.
      // Strict currency filter: exact match only (EUR → only EUR accounts).
      let pickerAccounts: WorkspaceAccountEntry[] = [];
      let totalAccountCount = 0; // total accounts in workspace (before currency filter)
      try {
        const allPickerAccounts = await getWorkspaceAccountsForPicker(workspaceId);
        totalAccountCount = allPickerAccounts.length;
        const txCur = aiData?.currency ?? null;
        pickerAccounts = txCur
          ? filterPickerAccounts(allPickerAccounts, txCur)
          : allPickerAccounts;
      } catch {
        pickerAccounts = [];
      }

      if (pickerAccounts.length > 0) {
        // Build picker: one row per account + "Создать счёт" + "Отмена"
        const intent = aiData?.intent ?? null;
        const pickerHeader = (intent === 'income' || intent === 'debt_received')
          ? '\uD83C\uDFE6 <b>\u041D\u0430 \u043A\u0430\u043A\u043E\u0439 \u0441\u0447\u0451\u0442 \u0437\u0430\u0447\u0438\u0441\u043B\u0438\u0442\u044C?</b>'
          : '\uD83C\uDFE6 <b>\u0421 \u043A\u0430\u043A\u043E\u0433\u043e \u0441\u0447\u0451\u0442\u0430 \u0441\u043F\u0438\u0441\u0430\u0442\u044C?</b>';

        const pickerRows = pickerAccounts.slice(0, 8).map((acc) => {
          // Strip trailing zeros: 15400.0000 → 15400
          const balDisplay = acc.balance.replace(/\.?0+$/, '') || '0';
          return [{ text: `\uD83C\uDFE6 ${acc.name} \u00B7 ${balDisplay} ${acc.currency}`, callback_data: `ia:pk:${acc.id}:${draftId}` }];
        });
        
        pickerRows.push([{ text: '➕ Создать счёт', callback_data: `ia:newac:${draftId}` }]);
        pickerRows.push([{ text: '✖️ Отмена', callback_data: `ia:cancel:${draftId}` }]);

        inlineKeyboard = { inline_keyboard: pickerRows };
        previewMsg = richPreview + '\n\n' + pickerHeader;

        console.log('[midas:ai-parse-worker] No account_hint — showing picker', {
          workspaceId, draftId, accountCount: pickerAccounts.length,
        });
      } else {
        // No matching accounts — distinguish "no accounts at all" vs "none in currency"
        const txCurDisplay = (aiData?.currency ?? '').toUpperCase() || null;
        const hasAccountsButWrongCurrency = totalAccountCount > 0 && !!txCurDisplay;

        if (hasAccountsButWrongCurrency) {
          // Accounts exist but NONE match the transaction currency
          // → "💱 У вас нет счетов в EUR" + "Создать счёт в EUR"
          inlineKeyboard = {
            inline_keyboard: [
              [{ text: `➕ Создать счёт в ${txCurDisplay}`, callback_data: `ia:newac:${draftId}` }],
              [{ text: '✖️ Отмена', callback_data: `ia:cancel:${draftId}` }],
            ],
          };
          previewMsg = richPreview + '\n\n' +
            `💱 <b>У вас нет счетов в ${escapeHtml(txCurDisplay)}</b>\n\n` +
            `<i>Для записи этой транзакции создайте счёт в ${escapeHtml(txCurDisplay)}.</i>`;
          console.log('[midas:ai-parse-worker] No accounts in currency — showing create prompt', {
            workspaceId, draftId, currency: txCurDisplay,
          });
        } else {
          // No accounts at all (fresh user / after reset)
          const intentNoAcc = aiData?.intent ?? null;
          const noAcctHeader = (intentNoAcc === 'income' || intentNoAcc === 'debt_received')
            ? '\uD83C\uDFE6 <b>\u041D\u0430 \u043A\u0430\u043A\u043E\u0439 \u0441\u0447\u0451\u0442 \u0437\u0430\u0447\u0438\u0441\u043B\u0438\u0442\u044C?</b>'
            : '\uD83C\uDFE6 <b>\u0421 \u043A\u0430\u043A\u043E\u0433\u043E \u0441\u0447\u0451\u0442\u0430 \u0441\u043F\u0438\u0441\u0430\u0442\u044C?</b>';
          inlineKeyboard = {
            inline_keyboard: [
              [{ text: '\u2795 \u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0441\u0447\u0451\u0442', callback_data: `ia:newac:${draftId}` }],
              [{ text: '\u2716\uFE0F \u041E\u0442\u043C\u0435\u043D\u0430', callback_data: `ia:cancel:${draftId}` }],
            ],
          };
          previewMsg = richPreview + '\n\n' + noAcctHeader
            + '\n\n<i>\u0423 \u0432\u0430\u0441 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0441\u0447\u0435\u0442\u043E\u0432. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u043F\u0435\u0440\u0432\u044B\u0439 \u0441\u0447\u0451\u0442, \u0447\u0442\u043E\u0431\u044B \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044E.</i>';
          console.log('[midas:ai-parse-worker] No accounts in workspace \u2014 showing create-account prompt', {
            workspaceId, draftId,
          });
        }
      }
    }

    // Phase 1.37-UX: Check if a previous "Не понял" card exists and should be deleted.
    const clarMsgCacheKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
    let prevClarMsgIdForDelete: string | undefined;
    try {
      const stored = await redisConnection.get(clarMsgCacheKey);
      if (stored) {
        prevClarMsgIdForDelete = stored;
        void redisConnection.del(clarMsgCacheKey);
      }
    } catch {
      prevClarMsgIdForDelete = undefined;
    }

    // Phase 1.40: Check if a stale "❌ Отменено" / "⏰ Черновик истёк" card
    // is still in chat. Delete it when the new preview card appears — so only
    // active (pending/confirmed) cards remain visible.
    const deadCardKey = `midas:dead_card:${chatId}`;
    let deadCardMsgId: string | undefined;
    try {
      const stored = await redisConnection.get(deadCardKey);
      if (stored) {
        deadCardMsgId = stored;
        void redisConnection.del(deadCardKey);
      }
    } catch {
      deadCardMsgId = undefined;
    }

    // Phase 1.40: If BOTH a dead card AND a voice status message exist,
    // we must delete both. The notification job only supports one deleteMessageId,
    // so we fire an extra job for the second one before the main preview.
    // Priority: voice status ("⏳ Распознаю...") goes in the main job (visual sync),
    //           dead card ("❌ Отменено") gets its own fire-and-forget job.
    if (deadCardMsgId && prevClarMsgIdForDelete) {
      // Send a dedicated delete job for the dead card
      const deadCardAlertId = ulid();
      void notificationsQueue.add(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          alertId: deadCardAlertId,
          workspaceId,
          chatId,
          message: '',
          deleteMessageId: deadCardMsgId,
        },
        { jobId: IdempotencyKeyBuilder.notification(workspaceId, deadCardAlertId) },
      );
    }

    // Main preview notification deletes the voice status message ("⏳ Распознаю голосовое...")
    // so it disappears exactly when the draft card appears.
    const msgToDelete = prevClarMsgIdForDelete ?? deadCardMsgId;

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
        deleteMessageId: msgToDelete,
        // NOTE: No activeMessageId — each preview card is a fresh message.
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
      // Missing amount — check if we also need currency (cur_set not yet set).
      // If so, ask for both in one message to reduce round-trips.
      const clarKey = `midas:clar:${telegramUserId}:${chatId}`;
      const curSetForAmt = await redisConnection.exists(`midas:cur_set:${workspaceId}`);

      if (curSetForAmt === 0) {
        // No default currency — ask for amount + currency together
        await redisConnection.set(clarKey, `${draftId}:amt+cur`, 'EX', 300);
        clarMsg = buildClarificationScreen({
          field: 'amount',
          intent: partialData?.intent ?? null,
          amount: null,
          currency: null, // will be prompted together
          categoryHint: partialData?.category_hint ?? null,
          askAmountWithCurrency: true, // Phase 1.38: combined prompt
        });
      } else {
        // Currency already set — ask for amount only
        await redisConnection.set(clarKey, `${draftId}:amt`, 'EX', 300);
        clarMsg = buildClarificationScreen({
          field: 'amount',
          intent: partialData?.intent ?? null,
          amount: null,
          currency: partialData?.currency ?? null,
          categoryHint: partialData?.category_hint ?? null,
        });
      }
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
        clarKeyboard = buildNonsenseKeyboard();
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
      clarKeyboard = buildNonsenseKeyboard();
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

    // Phase 1.40: Delete stale "❌ Отменено" dead card on clarification path too.
    // Without this, the card accumulates even when user sends a voice that needs clarification.
    let clarDeadCardMsgId: string | undefined;
    try {
      const stored = await redisConnection.get(`midas:dead_card:${chatId}`);
      if (stored) {
        clarDeadCardMsgId = stored;
        void redisConnection.del(`midas:dead_card:${chatId}`);
      }
    } catch { clarDeadCardMsgId = undefined; }

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
        deleteMessageId: clarDeadCardMsgId,   // Phase 1.40: delete stale dead card
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

    // ── Phase 3.1: Notify user on final failure so they know to retry ──
    // Only notify on final failure (no more retries left)
    const maxAttempts = job?.opts.attempts ?? 1;
    const isFinalFail = (job?.attemptsMade ?? 0) >= maxAttempts;
    if (isFinalFail && job?.data.chatId) {
      const failChatId = String(job.data.chatId);
      const failAlertId = ulid();
      void notificationsQueue.add(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          alertId: failAlertId,
          workspaceId: job.data.workspaceId ?? 'unknown',
          chatId: failChatId,
          message:
            '⚠️ <b>Не удалось обработать сообщение</b>\n\n' +
            'ИИ временно недоступен. Попробуйте отправить сообщение ещё раз через несколько секунд.',
        },
        { jobId: IdempotencyKeyBuilder.notification(job.data.workspaceId ?? 'unknown', failAlertId) },
      ).catch(() => { /* Non-fatal: secondary notification failure */ });
    }
  });




  return worker;
}
