/**
 * voice-parse Worker — Phase 2.1
 *
 * Processes jobs from the `voice-parse` queue.
 * Concurrency: 3 (xAI Grok STT rate limit: well within budget at ~$0.10/hr)
 *
 * Flow:
 *   1. Get Telegram file_path via getFile Bot API
 *   2. Download OGG audio buffer from Telegram CDN
 *   3. Transcribe via xAI Grok STT (groq-stt.ts)
 *   4a. On STT error/empty → edit status msg to user-friendly error UX
 *   4b. On success → store statusMessageId in midas:clar:msg: Redis key
 *       (ai-parse.worker reads this key and deletes it when draft card appears)
 *   5. Re-enqueue as AiParseJobPayload (raw_text = transcript)
 *      → ai-parse.worker handles the rest (Claude Haiku, draft, confirm card)
 *
 * Phase 2.2: Voice command detection — if transcript matches a navigation
 * command ("покажи баланс", "какой отчёт", etc.), executes it directly
 * WITHOUT creating a draft.
 *
 * SEC-12: Transcript text is NEVER logged in this worker.
 * SEC-03: workspaceId always comes from job payload (trusted backend source).
 */

import { Worker, type Job } from 'bullmq';
import {
  QUEUE_NAMES,
  type VoiceParseJobPayload,
  type AiParseJobPayload,
  detectCommand,
  type NavCommand,
  buildQuickEditAmountKb,
  buildQuickEditCategoryKb,
  buildQuickEditAccountKb,
  buildQuickEditIntentKb,
  type QECategoryInfo,
  type QEAccountInfo,
} from '@midas/shared';
import { withTenantTransaction } from '@midas/database';
import { transcribeVoice } from '@midas/ai-core';
import { redisConnection } from '../queues/redis.js';
import { aiParseQueue } from '../queues/queue-definitions.js';
import { ulid } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Telegram file download helpers
// ─────────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DOWNLOAD_TIMEOUT_MS = 15_000;

interface TelegramGetFileResult {
  ok: boolean;
  result?: { file_path?: string };
}

/**
 * Get the temporary download path for a Telegram file.
 * SEC-12: Only logs file_id length — not the ID itself.
 */
async function getTelegramFilePath(fileId: string): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, DOWNLOAD_TIMEOUT_MS);

    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;
    const data = (await resp.json()) as TelegramGetFileResult;
    return data.result?.file_path ?? null;
  } catch {
    return null;
  }
}

/**
 * Download a Telegram file as a Buffer.
 * Telegram CDN provides the file at: https://api.telegram.org/file/bot{token}/{file_path}
 */
async function downloadTelegramFile(filePath: string): Promise<Buffer | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, DOWNLOAD_TIMEOUT_MS);

    const resp = await fetch(
      `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!resp.ok) return null;
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Edit status message (update "⏳ Распознаю..." in-place)
// ─────────────────────────────────────────────────────────────

async function editStatusMessage(
  chatId: string,
  messageId: string,
  text: string,
  keyboard?: object,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: parseInt(messageId, 10),
        text,
        parse_mode: 'HTML',
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
    });
  } catch {
    // Non-fatal: status message may already be deleted or expired
  }
}

// ─────────────────────────────────────────────────────────────
// Phase 5.1-B: Send a new Telegram message, returns message_id string or null
// Used by edit_amount quick-edit to create the amount picker as a NEW message
// (cannot editStatusMessage — sentMsgId needed for Redis bridge).
// ─────────────────────────────────────────────────────────────

// @ts-ignore TS6133 — kept for future use; sole caller (edit_amount) removed in Fix 3
async function sendNewMessage(
  chatId: string,
  text: string,
  keyboard: object,
): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { ok: boolean; result?: { message_id?: number } };
    if (!data.ok || !data.result?.message_id) return null;
    return String(data.result.message_id);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Phase 5.1-B: Delete the '✅ Записано' success card if it exists
// Mirrors the cancel_last delete logic (Blindspot 4 — inline, not imported).
// Non-fatal: quick-edit picker opens regardless of deletion success.
// ─────────────────────────────────────────────────────────────

async function deleteSuccessCardW(
  telegramUserId: string,
  chatId: string,
): Promise<void> {
  try {
    const lcKey = `midas:last_confirmed:${telegramUserId}:${chatId}`;
    const amKey = `midas:am:${telegramUserId}:${chatId}`;
    const oldCardMsgId = await redisConnection.get(lcKey) ?? await redisConnection.get(amKey);
    if (oldCardMsgId && oldCardMsgId !== '0') {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token) {
        await fetch(`${TELEGRAM_API_BASE}/bot${token}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: parseInt(oldCardMsgId, 10) }),
        });
      }
      await redisConnection.del(lcKey);
      await redisConnection.del(amKey);
    }
  } catch {
    // Non-fatal — picker opens regardless
  }
}


// ─────────────────────────────────────────────────────────────
// Phase 2S2: Voice nav response builder (Blindspot 4: inline queries)
//
// The worker (background-workers) CANNOT import from telegram-bot services
// due to cross-app import boundaries. We duplicate minimal SQL queries
// here. This will be refactored in Phase 3 when @midas/database gets
// a shared service layer.
// ─────────────────────────────────────────────────────────────

interface VoiceNavResponse {
  text: string;
  keyboard?: object;
  editAmountBridge?: { txId: string };
}

async function buildVoiceNavResponse(
  cmd: NavCommand,
  workspaceId: string,
  userId: string,
  telegramUserId: string,
  chatId: string,
): Promise<VoiceNavResponse | null> {
  switch (cmd) {
    case 'balance': {
      // Full balance query — same SQL as balance.service.ts (PER_ACCOUNT_SQL)
      // Also fetches 'type' column for classifyAccountGroup grouping
      const result = await withTenantTransaction(workspaceId, userId, async (client) => {
        const r = await client.query<{
          id: string;
          name: string;
          type: string;
          currency: string;
          balance: { toFixed: (dp: number) => string };
          is_expense_default: boolean;
          is_income_default: boolean;
        }>(
          `SELECT a.id,
                  a.name,
                  a.type,
                  a.currency,
                  a.initial_balance
                    + COALESCE(SUM(CASE WHEN t.transaction_intent = 'income'        AND t.base_currency = a.currency THEN t.base_amount END), 0)
                    + COALESCE(SUM(CASE WHEN t.transaction_intent = 'debt_received' AND t.base_currency = a.currency THEN t.base_amount END), 0)
                    - COALESCE(SUM(CASE WHEN t.transaction_intent = 'expense'       AND t.base_currency = a.currency THEN t.base_amount END), 0)
                    - COALESCE(SUM(CASE WHEN t.transaction_intent = 'debt_given'    AND t.base_currency = a.currency THEN t.base_amount END), 0)
                    + COALESCE(SUM(CASE WHEN t.transaction_intent = 'transfer' AND t.transfer_direction = 'inbound'                                    AND t.base_currency = a.currency THEN t.base_amount END), 0)
                    - COALESCE(SUM(CASE WHEN t.transaction_intent = 'transfer' AND (t.transfer_direction = 'outbound' OR t.transfer_direction IS NULL) AND t.base_currency = a.currency THEN t.base_amount END), 0)
                    AS balance,
                  (a.id = w.default_expense_account_id) AS is_expense_default,
                  (a.id = w.default_income_account_id)  AS is_income_default
           FROM account_sources a
           LEFT JOIN workspaces w ON w.id = a.workspace_id
           LEFT JOIN transactions t
             ON t.account_id = a.id AND t.workspace_id = $1 AND t.deleted_at IS NULL
           WHERE a.workspace_id = $1
             AND a.deleted_at IS NULL
             AND a.parent_account_id IS NULL
           GROUP BY a.id, a.name, a.type, a.currency, a.initial_balance,
                    w.default_expense_account_id, w.default_income_account_id
           ORDER BY a.name`,
          [workspaceId],
        );
        return r.rows;
      });

      if (!result || result.length === 0) {
        return {
          text: '💼 <b>Баланс по счетам:</b>\n\nСчетов пока нет.',
          keyboard: {
            inline_keyboard: [
              [{ text: '➕ Добавить счёт', callback_data: 'bl:add' }],
              [{ text: '✖️ Закрыть',       callback_data: 'bl:close' }],
            ],
          },
        };
      }

      // ── Inline replicas of balance-keyboard.service.ts helpers ──
      // (cross-app import forbidden — Blindspot 4)
      const CCY_SYM: Record<string, string> = {
        RUB: '₽', USD: '$', EUR: '€', UAH: '₴', GBP: '£',
        KZT: '₸', BYN: 'Br', GEL: '₾', PLN: 'zł', TRY: '₺',
        CNY: '¥', JPY: '¥', HKD: 'HK$', SGD: 'S$', AUD: 'A$',
        CAD: 'C$', CHF: 'Fr',
      };
      const sym = (code: string): string => CCY_SYM[code] ?? code;

      // formatBalanceShort — exact replica from balance-keyboard.service.ts
      const fmtBal = (numStr: string): string => {
        const n = parseFloat(numStr);
        if (isNaN(n)) return numStr;
        return n.toLocaleString('ru-RU', {
          minimumFractionDigits: n % 1 === 0 ? 0 : 2,
          maximumFractionDigits: 6,
        });
      };

      // classifyAccountGroup — exact replica from balance-keyboard.service.ts
      // Stablecoins/crypto → exchange or wallet, fiat → bank, nalichnie → cash
      const EXCHANGE_RE = /okx|okex|binance|bybit|kraken|huobi|kucoin|gate\.io|mexc|bitget|coinbase|биржа|exchange/i;
      const CASH_RE     = /наличн|нал\b|кэш|кеш|cash|налик/i;
      const CRYPTO_CURRENCIES = new Set([
        'BTC','ETH','USDT','USDC','BNB','SOL','XRP','ADA','DOGE','TON',
        'TRX','DOT','MATIC','LTC','SHIB','AVAX','UNI','LINK','ATOM','XLM',
      ]);
      const STABLE_CURRENCIES = new Set(['USDT','USDC','DAI','BUSD','TUSD','USDP','FRAX','LUSD']);
      type GrpType = 'bank' | 'crypto_exchange' | 'crypto_wallet' | 'cash' | 'other';
      const classifyGrp = (name: string, currency: string, type: string): GrpType => {
        if (type === 'bank_sync')        return 'bank';
        if (type === 'crypto_read_only') return 'crypto_exchange';
        const isCrypto = CRYPTO_CURRENCIES.has(currency) || STABLE_CURRENCIES.has(currency);
        if (isCrypto) return EXCHANGE_RE.test(name) ? 'crypto_exchange' : 'crypto_wallet';
        return CASH_RE.test(name) ? 'cash' : 'bank';
      };

      const GRP_EMOJI: Record<GrpType, string> = {
        bank:            '🏦',
        crypto_exchange: '📈',
        crypto_wallet:   '🔐',
        cash:            '💵',
        other:           '📂',
      };
      const GRP_ORDER: GrpType[] = ['bank', 'crypto_exchange', 'crypto_wallet', 'cash', 'other'];
      const GRP_NAMES: Record<GrpType, string> = {
        bank:            '🏦 Банки',
        crypto_exchange: '📈 Биржи',
        crypto_wallet:   '🔐 Крипто',
        cash:            '💵 Наличные',
        other:           '📂 Прочее',
      };

      // Group accounts by type
      const grouped = new Map<GrpType, typeof result>();
      const sortedResult = [...result].sort((a, b) => {
        const ga = classifyGrp(a.name, a.currency, a.type);
        const gb = classifyGrp(b.name, b.currency, b.type);
        const diff = GRP_ORDER.indexOf(ga) - GRP_ORDER.indexOf(gb);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, 'ru');
      });
      for (const a of sortedResult) {
        const g = classifyGrp(a.name, a.currency, a.type);
        if (!grouped.has(g)) grouped.set(g, []);
        grouped.get(g)!.push(a);
      }

      // ── Build text — same format as balance.service.ts ──
      const textSections: string[] = [];
      for (const grp of GRP_ORDER) {
        const rows = grouped.get(grp);
        if (!rows?.length) continue;
        const lines = rows.map((a) => {
          const isStar = Boolean(a.is_expense_default) && Boolean(a.is_income_default);
          const star = isStar ? ' ⭐' : '';
          const balStr = fmtBal(a.balance.toFixed(2));
          return `▸ <b>${escapeHtmlSimple(a.name)}${star}</b> — <b>${balStr}\u00a0${sym(a.currency)}</b>`;
        });
        textSections.push(`${GRP_NAMES[grp]}\n${lines.join('\n')}`);
      }

      // ── Build keyboard — same format as buildBalanceListKeyboard ──
      const accountRows = sortedResult.map((a) => {
        const grp   = classifyGrp(a.name, a.currency, a.type);
        const emoji = GRP_EMOJI[grp];
        const isStar = Boolean(a.is_expense_default) && Boolean(a.is_income_default);
        const star  = isStar ? ' ⭐' : '';
        const balFmt = `${fmtBal(a.balance.toFixed(2))}\u00a0${sym(a.currency)}`;
        return [{ text: `${emoji} ${a.name}${star}  ·  ${balFmt}`, callback_data: `bl:v:${a.id}` }];
      });

      return {
        text: `💼 <b>Баланс</b>\n\n${textSections.join('\n\n')}`,
        keyboard: {
          inline_keyboard: [
            [{ text: '➕ Добавить счёт', callback_data: 'bl:add' }],
            ...accountRows,
            [{ text: '✖️ Закрыть', callback_data: 'bl:close' }],
          ],
        },
      };
    }

    case 'settings': {
      // Settings are in 'workspaces' table, not 'settings'
      // Text: only timezone — matches formatSettingsMenuText() from settings-keyboard.service.ts
      // Keyboard: full replica of buildSettingsMainKeyboard() (cross-app import forbidden — Blindspot 4)
      const result = await withTenantTransaction(workspaceId, userId, async (client) => {
        const r = await client.query<{
          timezone: string;
        }>(
          `SELECT w.timezone FROM workspaces w WHERE w.id = $1`,
          [workspaceId],
        );
        return r.rows[0] ?? null;
      });

      const tz = result?.timezone ?? 'UTC';

      return {
        text: `⚙️ <b>Настройки Midas</b>\n\n🕒 Часовой пояс: <b>${escapeHtmlSimple(tz)}</b>`,
        keyboard: {
          inline_keyboard: [
            [{ text: '🕒 Часовой пояс',  callback_data: 'st:tz' }],
            [{ text: '🔔 Уведомления',   callback_data: 'st:ntf' }],
            [{ text: '📤 Экспорт',       callback_data: 'st:exp' }],
            [{ text: '💬 Поддержка',     url: 'https://t.me/midas_support' }],
            [{ text: '✖️ Закрыть',       callback_data: 'st:cancel' }],
          ],
        },
      };
    }

    case 'export':
      return {
        text: '📤 <b>Экспорт данных</b>\n\nШаг 1 из 3 — выберите <b>период</b>:',
        keyboard: {
          inline_keyboard: [
            [
              { text: '📅 Этот месяц',    callback_data: 'st:exp:p:tm' },
              { text: '📅 Прошлый месяц', callback_data: 'st:exp:p:lm' },
            ],
            [
              { text: '📅 3 месяца',      callback_data: 'st:exp:p:3m' },
              { text: '📅 Весь период',    callback_data: 'st:exp:p:yr' },
            ],
            [{ text: '✖️ Закрыть', callback_data: 'st:fin' }],
          ],
        },
      };

    case 'add_account':
      return {
        text: '➕ <b>Новый счёт</b>\n\nВыберите тип счёта:',
        keyboard: {
          inline_keyboard: [
            [
              { text: '🏦 Банковский счёт', callback_data: 'ac:type:bank' },
              { text: '💳 Карта',           callback_data: 'ac:type:card' },
            ],
            [
              { text: '💵 Наличные',        callback_data: 'ac:type:cash' },
              { text: '🔐 Кошелёк',         callback_data: 'ac:type:wallet' },
            ],
            [{ text: '✏️ Своё название', callback_data: 'ac:type:custom' }],
            [{ text: '✖️ Отмена', callback_data: 'ac:fin' }],
          ],
        },
      };

    case 'help':
      return {
        text:
          '🏦 <b>Midas — справочник</b>\n\n' +
          '📝 <b>КАК ЗАПИСАТЬ ОПЕРАЦИЮ</b>\n' +
          'Просто напишите в чат или запишите голосовое:\n' +
          '<blockquote>кофе 350 RUB\nNetflix 15 USDT\nзарплата 95 000 RUB</blockquote>\n\n' +
          '🎤 <b>ГОЛОСОВЫЕ КОМАНДЫ</b>\n' +
          '«Покажи баланс» · «Настройки» · «Экспорт»\n' +
          '«Добавь счёт» · «Отмени последнюю» · «Помощь»\n\n' +
          '❓ Вопросы → @midas_support',
        keyboard: {
          inline_keyboard: [
            [{ text: '✖️ Закрыть справочник', callback_data: 'bl:close' }],
          ],
        },
      };

    case 'report':
      return {
        text: '📊 <b>Отчёты</b>\n\nВыбери период:',
        keyboard: {
          inline_keyboard: [
            [
              { text: '📅 Этот месяц', callback_data: 'rpt:tm' },
              { text: '📅 Прошлый',    callback_data: 'rpt:lm' },
            ],
            [
              { text: '📅 Квартал',    callback_data: 'rpt:3m' },
              { text: '📅 Год',        callback_data: 'rpt:yr' },
            ],
          ],
        },
      };

    case 'cancel_last': {
      // Phase 2S2+: Query last transaction with all display fields
      const lastTx = await withTenantTransaction(workspaceId, userId, async (client) => {
        const r = await client.query<{
          id: string;
          item_name: string | null;
          original_amount: string;
          currency: string;
          transaction_intent: string;
          created_at: string;
          category_name: string | null;
          account_name: string | null;
          account_currency: string | null;
          account_debit_amount: string | null;
          account_debit_currency: string | null;
        }>(
          `SELECT t.id, t.item_name, t.original_amount, t.currency,
                  t.transaction_intent, t.created_at,
                  c.name    AS category_name,
                  a.name    AS account_name,
                  a.currency AS account_currency,
                  t.account_debit_amount,
                  t.account_debit_currency
           FROM transactions t
           LEFT JOIN categories      c ON c.id = t.category_id
           LEFT JOIN account_sources a ON a.id = t.account_id
           WHERE t.workspace_id = $1 AND t.deleted_at IS NULL
             AND (t.transfer_direction IS DISTINCT FROM 'inbound')
           ORDER BY t.created_at DESC
           LIMIT 1`,
          [workspaceId],
        );
        return r.rows[0] ?? null;
      });

      if (!lastTx) {
        return { text: '📭 Нет транзакций для отмены.' };
      }

      // ── Format confirmation card ──────────────────────────────────────────
      const intentLabels: Record<string, string> = {
        expense: '💸 Расход', income: '💰 Доход',
        transfer: '🔄 Перевод', debt_given: '📤 Долг (дал)',
        debt_received: '📥 Долг (взял)',
      };
      const intentLabel = intentLabels[lastTx.transaction_intent] ?? lastTx.transaction_intent;
      const name = lastTx.item_name ? escapeHtmlSimple(lastTx.item_name) : null;
      const amtStr = String(lastTx.original_amount);
      const amountFmt = (amtStr.includes('.') ? amtStr.replace(/\.?0+$/, '') : amtStr) || '0';

      const dt = (() => {
        try {
          const d = new Date(lastTx.created_at);
          const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}, ${d.getDate()} ${months[d.getMonth()] ?? ''}`;
        } catch {
          return lastTx.created_at;
        }
      })();

      // Build blockquote body: amount + item name
      const amountLine = `<b>${amountFmt} ${escapeHtmlSimple(lastTx.currency)}</b>`;
      const blockContent = name ? `${amountLine}\n${name}` : amountLine;
      const blockquote = `<blockquote>${blockContent}</blockquote>`;

      const lines: string[] = [
        `🗑 <b>Удалить эту транзакцию?</b>`,
        '',
        `${intentLabel}`,
        blockquote,
        '',
        ...(lastTx.category_name ? [`📁 ${escapeHtmlSimple(lastTx.category_name)}`] : []),
        `⏰ <i>${dt}</i>`,
        '',
        'Транзакция будет скрыта из всех отчётов и баланс пересчитается.',
      ];

      // ── Save full data to Redis for cl:n (restore) ───────────────────────
      const clDataKey = `midas:cl:data:${lastTx.id}`;
      const clData = {
        intent:          lastTx.transaction_intent,
        amount:          String(lastTx.original_amount),
        currency:        lastTx.currency,
        itemName:        lastTx.item_name ?? null,
        categoryName:    lastTx.category_name ?? null,
        accountName:     lastTx.account_name ?? null,
        transactionTime: lastTx.created_at,
        accountCurrency: lastTx.account_currency ?? null,
        debitAmount:     lastTx.account_debit_amount ? String(lastTx.account_debit_amount) : null,
        debitCurrency:   lastTx.account_debit_currency ?? null,
      };
      void redisConnection.set(clDataKey, JSON.stringify(clData), 'EX', 600);

      // ── Delete the old confirmed card (midas:am:) ─────────────────────────
      // The "✅ Записано" card with [✏️ Изменить запись] should disappear
      // when the user initiates cancel, so the confirmation screen is clear.
      try {
        // Try midas:last_confirmed first (set by notifications worker for success cards),
        // fallback to midas:am: (set by webhook for non-success edits).
        // Notifications worker DEL's midas:am: for success cards to protect from step-7 cleanup.
        const lcKey = `midas:last_confirmed:${telegramUserId}:${chatId}`;
        const amKey = `midas:am:${telegramUserId}:${chatId}`;
        const oldCardMsgId = await redisConnection.get(lcKey) ?? await redisConnection.get(amKey);
        console.log('[midas:voice-parse-worker] cancel_last: delete old card check', {
          lcKey, amKey, oldCardMsgId, hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
        });
        if (oldCardMsgId && oldCardMsgId !== '0') {
          const token = process.env.TELEGRAM_BOT_TOKEN;
          if (token) {
            const delResp = await fetch(`${TELEGRAM_API_BASE}/bot${token}/deleteMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, message_id: parseInt(oldCardMsgId, 10) }),
            });
            const delBody = await delResp.text();
            console.log('[midas:voice-parse-worker] cancel_last: deleteMessage response', {
              status: delResp.status, body: delBody.slice(0, 200),
            });
          }
          // Clean up both keys
          await redisConnection.del(lcKey);
          await redisConnection.del(amKey);
        }
      } catch (delErr) {
        console.error('[midas:voice-parse-worker] cancel_last: delete old card FAILED', {
          error: delErr instanceof Error ? delErr.message : 'unknown',
        });
      }

      return {
        text: lines.join('\n'),
        keyboard: {
          inline_keyboard: [
            [
              { text: '🗑 Да, удалить', callback_data: `cl:y:${lastTx.id}` },
              { text: '◄️ Отмена',      callback_data: `cl:n:${lastTx.id}` },
            ],
          ],
        },
      };
    }

    case 'edit_last': {
      // ── Phase 2S2: edit_last — show full transaction card with edit buttons ──
      // SQL mirrors getLastTransaction + getTransactionCard (can't import from telegram-bot).
      const editTx = await withTenantTransaction(workspaceId, userId, async (client) => {
        const r = await client.query<{
          id: string;
          item_name: string | null;
          original_amount: string;
          base_amount: string;
          currency: string;
          base_currency: string;
          transaction_intent: string;
          transaction_time: string;
          category_name: string;
          account_name: string;
          is_cross_currency: boolean;
        }>(
          `SELECT t.id, t.item_name,
                  ROUND(t.original_amount, 2)::text  AS original_amount,
                  ROUND(t.base_amount, 2)::text       AS base_amount,
                  t.currency,
                  t.base_currency,
                  t.transaction_intent,
                  t.transaction_time::text,
                  COALESCE(c.name, '—')  AS category_name,
                  COALESCE(a.name, '—')  AS account_name,
                  (t.exchange_rate != 1.000000000000) AS is_cross_currency
           FROM transactions t
           LEFT JOIN categories      c ON c.id = t.category_id
           LEFT JOIN account_sources a ON a.id = t.account_id
           WHERE t.workspace_id = $1 AND t.deleted_at IS NULL
             AND (t.transfer_direction IS DISTINCT FROM 'inbound')
           ORDER BY t.created_at DESC
           LIMIT 1`,
          [workspaceId],
        );
        return r.rows[0] ?? null;
      });

      if (!editTx) {
        return { text: '📭 Нет транзакций для редактирования.' };
      }

      // ── Format card (mirrors formatTxDetailCard from screen-builder.ts) ──
      const intentEmojis: Record<string, string> = {
        expense: '💸', income: '💰', transfer: '🔄',
        debt_given: '🤝', debt_received: '🤲',
      };
      const intentNames: Record<string, string> = {
        expense: 'Расход', income: 'Доход', transfer: 'Перевод',
        debt_given: 'Долг (дал)', debt_received: 'Долг (взял)',
      };
      const emoji = intentEmojis[editTx.transaction_intent] ?? '';
      const label = intentNames[editTx.transaction_intent] ?? editTx.transaction_intent;

      // Amount: use base_amount for same-currency, original for cross-currency
      const amtRaw = editTx.is_cross_currency ? editTx.original_amount : editTx.base_amount;
      const amtCur = editTx.is_cross_currency ? editTx.currency : (editTx.base_currency || editTx.currency);
      // Format amount: strip trailing .00 but keep meaningful decimals
      const fmtAmt = (() => {
        const dot = amtRaw.indexOf('.');
        if (dot === -1) return `${amtRaw}.00`;
        const int = amtRaw.slice(0, dot);
        const frac = amtRaw.slice(dot + 1).padEnd(2, '0').slice(0, 2);
        return `${int}.${frac}`;
      })();

      const dtObj = new Date(editTx.transaction_time);
      const dateStr = `${String(dtObj.getDate()).padStart(2, '0')}.${String(dtObj.getMonth() + 1).padStart(2, '0')}.${dtObj.getFullYear()}`;

      const isTransfer = editTx.transaction_intent === 'transfer';
      const cardLines = [
        '📋 <b>Транзакция</b>',
        '',
        `${emoji} ${label}`,
        `💰 Сумма: <b>${fmtAmt} ${escapeHtmlSimple(amtCur)}</b>`,
        ...(isTransfer ? [] : [`📁 Категория: ${escapeHtmlSimple(editTx.category_name)}`]),
        `🏦 Счёт: ${escapeHtmlSimple(editTx.account_name)}`,
        `📅 Дата: ${dateStr}`,
      ];

      // ── Build keyboard (same callback_data as existing tx: handlers) ──
      const kbRows: { text: string; callback_data: string }[][] = [];
      if (!editTx.is_cross_currency) {
        kbRows.push([{ text: '✏️ Изменить сумму', callback_data: `tx:f:amt:${editTx.id}:s` }]);
      }
      kbRows.push([{ text: '📁 Изменить категорию', callback_data: `tx:f:cat:${editTx.id}:0:s` }]);
      kbRows.push([{ text: '🏦 Изменить счёт', callback_data: `tx:f:acc:${editTx.id}:s` }]);
      kbRows.push([{ text: '🔄 Изменить тип', callback_data: `tx:f:int:${editTx.id}:s` }]);
      kbRows.push([{ text: '🗑️ Удалить', callback_data: `tx:d:ask:${editTx.id}:s` }]);
      kbRows.push([{ text: '✖️ Закрыть', callback_data: `tx:done:${editTx.id}` }]);

      return {
        text: cardLines.join('\n'),
        keyboard: { inline_keyboard: kbRows },
      };
    }

    case 'transactions': {
      // Phase 2S2+: Full Transaction Hub inline (Blindspot 4 — duplicated from transaction-hub.service.ts
      // and transaction-keyboard.service.ts; can't cross-import from telegram-bot).
      const TX_PAGE_SIZE_V = 5;
      const filter = 'a'; // always open with "All" filter, same as Reply Keyboard button

      // ── Step 1: Parallel queries ──────────────────────────────────────────
      const [txItems, txTotal, txStats] = await withTenantTransaction(workspaceId, userId, async (client) => {
        const [itemsRes, cntRes, statsRes, wsRes] = await Promise.all([
          // Transaction list (page 0, filter 'a', with transfer enrichment)
          client.query<{
            id: string;
            base_amount: string;
            base_currency: string;
            transaction_intent: string;
            transaction_time: string;
            category_name: string;
            item_name: string | null;
            transfer_direction: string | null;
            from_account: string | null;
            to_account: string | null;
            to_amount: string | null;
            to_currency: string | null;
          }>(
            `SELECT
               t.id,
               ROUND(t.base_amount, 2)::text AS base_amount,
               t.base_currency,
               t.transaction_intent,
               t.transaction_time::text,
               COALESCE(c.name, '—') AS category_name,
               t.item_name,
               t.transfer_direction,
               COALESCE(a_src.name, NULL) AS from_account,
               COALESCE(a_tgt.name, NULL) AS to_account,
               ROUND(t_in.base_amount, 2)::text AS to_amount,
               t_in.base_currency AS to_currency
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             LEFT JOIN account_sources a_src ON a_src.id = t.account_id
               AND t.transaction_intent = 'transfer'
             LEFT JOIN transactions t_in
               ON  t_in.transfer_group_id = t.transfer_group_id
               AND t_in.transfer_direction = 'inbound'
               AND t_in.deleted_at IS NULL
               AND t.transaction_intent = 'transfer'
               AND t.transfer_direction = 'outbound'
             LEFT JOIN account_sources a_tgt ON a_tgt.id = t_in.account_id
               AND t.transaction_intent = 'transfer'
             WHERE t.workspace_id = $1
               AND t.deleted_at IS NULL
               AND (t.transfer_direction IS DISTINCT FROM 'inbound')
             ORDER BY t.transaction_time DESC
             LIMIT $2 OFFSET 0`,
            [workspaceId, TX_PAGE_SIZE_V],
          ),
          // Total count
          client.query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt
             FROM transactions
             WHERE workspace_id = $1
               AND deleted_at IS NULL
               AND (transfer_direction IS DISTINCT FROM 'inbound')`,
            [workspaceId],
          ),
          // Month mini stats
          client.query<{
            expense_count: string; income_count: string;
            debt_given_count: string; debt_received_count: string;
            transfer_count: string; expense_total: string; income_total: string;
          }>(
            `SELECT
               COUNT(*) FILTER (WHERE transaction_intent = 'expense')::text AS expense_count,
               COUNT(*) FILTER (WHERE transaction_intent = 'income')::text AS income_count,
               COUNT(*) FILTER (WHERE transaction_intent = 'debt_given')::text    AS debt_given_count,
               COUNT(*) FILTER (WHERE transaction_intent = 'debt_received')::text AS debt_received_count,
               COUNT(*) FILTER (WHERE transaction_intent = 'transfer'
                 AND (transfer_direction IS DISTINCT FROM 'inbound'))::text       AS transfer_count,
               COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'expense'), 0)::text AS expense_total,
               COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'income'), 0)::text  AS income_total
             FROM transactions
             WHERE workspace_id = $1
               AND deleted_at IS NULL
               AND transaction_time >= date_trunc('month', NOW())
               AND transaction_time <  date_trunc('month', NOW()) + interval '1 month'`,
            [workspaceId],
          ),
          // Workspace default currency for header
          client.query<{ default_currency: string }>(
            `SELECT default_currency FROM workspaces WHERE id = $1`,
            [workspaceId],
          ),
        ]);

        const statsRow = statsRes.rows[0];
        const currency = wsRes.rows[0]?.default_currency ?? 'USDT';
        return [
          itemsRes.rows,
          parseInt(cntRes.rows[0]?.cnt ?? '0', 10),
          {
            expense_count:       parseInt(statsRow?.expense_count       ?? '0', 10),
            income_count:        parseInt(statsRow?.income_count        ?? '0', 10),
            debt_given_count:    parseInt(statsRow?.debt_given_count    ?? '0', 10),
            debt_received_count: parseInt(statsRow?.debt_received_count ?? '0', 10),
            transfer_count:      parseInt(statsRow?.transfer_count      ?? '0', 10),
            expense_total:  statsRow?.expense_total  ?? '0',
            income_total:   statsRow?.income_total   ?? '0',
            currency,
          },
        ] as const;
      });

      // ── Step 2: Build header text (mirrors formatTxListHeader) ──────────
      const MONTH_NAMES_RU_V = ['январь','февраль','март','апрель','май','июнь',
                                'июль','август','сентябрь','октябрь','ноябрь','декабрь'];
      function pluralRuV(n: number): string {
        const abs = Math.abs(n) % 100;
        const last = abs % 10;
        if (abs >= 11 && abs <= 19) return 'ов';
        if (last === 1) return '';
        if (last >= 2 && last <= 4) return 'а';
        return 'ов';
      }
      const monthName = MONTH_NAMES_RU_V[new Date().getMonth()] ?? '';
      const parts: string[] = [];
      if (txStats.expense_count > 0)
        parts.push(`${String(txStats.expense_count)} расход${pluralRuV(txStats.expense_count)}`);
      if (txStats.income_count > 0)
        parts.push(`${String(txStats.income_count)} доход${pluralRuV(txStats.income_count)}`);
      const totalDebt = txStats.debt_given_count + txStats.debt_received_count;
      if (totalDebt > 0) parts.push(`${String(totalDebt)} долг${pluralRuV(totalDebt)}`);
      if (txStats.transfer_count > 0)
        parts.push(`${String(txStats.transfer_count)} перевод${pluralRuV(txStats.transfer_count)}`);
      const summary = parts.length > 0 ? parts.join(' · ') : 'нет транзакций';
      const headerText = `<b>📋 Транзакции</b>\n\nЗа ${monthName}: ${summary}`;

      // ── Step 3: Build keyboard (mirrors buildTxListKeyboard) ─────────────
      const CCY_SYM_V: Record<string, string> = {
        RUB: '₽', USD: '$', EUR: '€', UAH: '₴', GBP: '£',
        KZT: '₸', BYN: 'Br', GEL: '₾', PLN: 'zł', TRY: '₺',
        CNY: '¥', JPY: '¥', HKD: 'HK$', SGD: 'S$', AUD: 'A$',
        CAD: 'C$', CHF: 'Fr',
      };
      function fmtCurV(code: string): string { return CCY_SYM_V[code] ?? code; }
      function fmtAmtV(s: string): string {
        const dot = s.indexOf('.');
        if (dot === -1) return `${s}.00`;
        const int2 = s.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const frac = s.slice(dot + 1).padEnd(2, '0').slice(0, 2);
        return `${int2}.${frac}`;
      }
      function shortDateV(iso: string): string {
        const d = new Date(iso);
        return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`;
      }
      function intentEmojiV(intent: string): string {
        switch (intent) {
          case 'income': return '💰'; case 'expense': return '💸';
          case 'debt_given': return '🤝'; case 'debt_received': return '🤲';
          default: return '🔄';
        }
      }
      function escV(s: string): string {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      }

      const FILTER_LABELS_V: Record<string, { text: string; active: string }> = {
        e: { text: '💸',       active: '💸 ✓' },
        i: { text: '💰',       active: '💰 ✓' },
        d: { text: '🤝',       active: '🤝 ✓' },
        t: { text: '🔄',       active: '🔄 ✓' },
        a: { text: '📋 Все',   active: '📋 Все ✓' },
      };

      const kbRows: { text: string; callback_data: string }[][] = [];

      // Filter row (all buttons, 'a' is active)
      kbRows.push(['e','i','d','t','a'].map((f) => {
        const isActive = f === filter;
        const lbl = isActive ? (FILTER_LABELS_V[f]?.active ?? f) : (FILTER_LABELS_V[f]?.text ?? f);
        const cbf = (isActive && f !== 'a') ? 'a' : f;
        return { text: lbl, callback_data: `tx:l:0:${cbf}` };
      }));

      // Search button
      kbRows.push([{ text: '🔍 Поиск', callback_data: 'tx:s' }]);

      // Transaction rows
      for (const tx of txItems) {
        const emoji = intentEmojiV(tx.transaction_intent);
        const amt   = fmtAmtV(tx.base_amount);
        const cur   = fmtCurV(tx.base_currency);
        const date  = shortDateV(tx.transaction_time);

        if (tx.transaction_intent === 'transfer' && tx.from_account && tx.to_account && tx.to_amount && tx.to_currency) {
          const toAmt = fmtAmtV(tx.to_amount);
          const toCur = fmtCurV(tx.to_currency);
          kbRows.push([{
            text: `🔄 ${escV(tx.from_account)} → ${escV(tx.to_account)}  ${amt} ${cur} → ${toAmt} ${toCur}  ${date}`,
            callback_data: `tx:v:${tx.id}`,
          }]);
          continue;
        }

        const label = tx.item_name ? escV(tx.item_name) : escV(tx.category_name);
        kbRows.push([{ text: `${emoji} ${label}  ${amt} ${cur}  ${date}`, callback_data: `tx:v:${tx.id}` }]);
      }

      // Pagination row
      const totalPages = Math.max(1, Math.ceil(txTotal / TX_PAGE_SIZE_V));
      if (totalPages > 1) {
        const navRow: { text: string; callback_data: string }[] = [];
        navRow.push({ text: `📄 1 / ${String(totalPages)}`, callback_data: 'tx:x' });
        navRow.push({ text: 'Раньше ➡️', callback_data: 'tx:l:1:a' });
        kbRows.push(navRow);
      }

      // Close button
      kbRows.push([{ text: '✖️ Закрыть', callback_data: 'tx:close' }]);

      return {
        text: headerText,
        keyboard: { inline_keyboard: kbRows },
      };
    }

    // ── Phase 5.1-B: Context-Aware Quick Edits — Voice Path ──────────────────
    // When the user sends a VOICE message saying "измени категорию", the STT
    // transcribes it, detectCommand returns the edit_* NavCommand, and we arrive
    // here. We build the SAME UI as the text path (handleQuickEditField in
    // webhook.route.ts) using the shared builder functions from @midas/shared.
    //
    // Layer 1 (data): raw SQL — cannot import telegram-bot services (Blindspot 4)
    // Layer 2 (UI):   buildQuickEdit*Kb from @midas/shared — zero duplication
    // Layer 3 (transport): depends on field:
    //   cat/acc/int → return { text, keyboard } → caller does editStatusMessage
    //   amt         → sendNewMessage (needs sentMsgId) + Redis bridge → return __SENT__
    //
    // backSuffix ':s' → ◀️ Назад → tx:v:{txId}:s → standalone card → ✖️ Закрыть

    case 'edit_amount':
    case 'edit_category':
    case 'edit_account':
    case 'edit_type': {
      // ── SINGLE withTenantTransaction for ALL data ─────────────────────────
      // FIX: Previously edit_category/edit_account used TWO sequential
      // withTenantTransaction calls (= 2x pool.connect()). On Railway's
      // connection-limited Postgres the 2nd timed out → picker never opened.
      // Now all queries share ONE connection. Categories/accounts fetched
      // conditionally inside the same callback.
      const { qeTx, allCats, accounts } = await withTenantTransaction(workspaceId, userId, async (client) => {
        // 1. Last transaction (needed by all 4 commands)
        const txR = await client.query<{
          id: string;
          category_name: string | null;
          base_currency: string;
          is_cross_currency: boolean;
        }>(
          `SELECT t.id,
                  c.name AS category_name,
                  t.base_currency,
                  (t.exchange_rate != 1.000000000000) AS is_cross_currency
           FROM transactions t
           LEFT JOIN categories c ON c.id = t.category_id
           WHERE t.workspace_id = $1
             AND t.deleted_at IS NULL
             AND (t.transfer_direction IS DISTINCT FROM 'inbound')
           ORDER BY t.created_at DESC
           LIMIT 1`,
          [workspaceId],
        );
        const lastTx = txR.rows[0] ?? null;

        // 2. Categories — only for edit_category (same client, zero extra connections)
        // NOTE: categories table has NO deleted_at column!
        let cats: QECategoryInfo[] = [];
        if (cmd === 'edit_category' && lastTx) {
          const catR = await client.query<QECategoryInfo>(
            `SELECT id, name, "group", icon, is_custom
             FROM categories
             WHERE workspace_id = $1
             ORDER BY is_custom, "group", name`,
            [workspaceId],
          );
          cats = catR.rows;
        }

        // 3. Accounts — only for edit_account (same client, zero extra connections)
        let accs: QEAccountInfo[] = [];
        if (cmd === 'edit_account' && lastTx) {
          const accR = await client.query<QEAccountInfo>(
            `SELECT
               a.id,
               a.name,
               a.currency,
               (
                 a.initial_balance
                 + COALESCE(SUM(CASE WHEN t.transaction_intent IN ('income','debt_received')
                                         AND t.base_currency = a.currency THEN t.base_amount END), 0)
                 - COALESCE(SUM(CASE WHEN t.transaction_intent IN ('expense','debt_given')
                                         AND t.base_currency = a.currency THEN t.base_amount END), 0)
                 + COALESCE(SUM(CASE WHEN t.transaction_intent = 'transfer'
                                         AND t.transfer_direction = 'inbound'
                                         AND t.base_currency = a.currency THEN t.base_amount END), 0)
                 - COALESCE(SUM(CASE WHEN t.transaction_intent = 'transfer'
                                         AND (t.transfer_direction = 'outbound' OR t.transfer_direction IS NULL)
                                         AND t.base_currency = a.currency THEN t.base_amount END), 0)
               )::text AS balance
             FROM account_sources a
             LEFT JOIN transactions t
               ON t.account_id = a.id AND t.workspace_id = $1 AND t.deleted_at IS NULL
             WHERE a.workspace_id = $1
               AND a.deleted_at IS NULL
               AND a.parent_account_id IS NULL
             GROUP BY a.id, a.name, a.currency, a.initial_balance
             ORDER BY a.name`,
            [workspaceId],
          );
          accs = accR.rows;
        }

        return { qeTx: lastTx, allCats: cats, accounts: accs };
      });

      if (!qeTx) {
        return { text: '\u{1F4AD} \u041d\u0435\u0442 \u0442\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0439 \u0434\u043b\u044f \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f.' };
      }

      // ── Step 3: Field-specific data + builder ──────────────────────────────
      const SF = ':s'; // standalone suffix — ◀️ Назад → tx:v:{txId}:s

      if (cmd === 'edit_amount') {
        // Guard: cross-currency transactions cannot have their amount changed.
        if (qeTx.is_cross_currency) {
          return {
            text: '\u26a0\ufe0f \u0418\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0435 \u0441\u0443\u043c\u043c\u044b \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e \u0434\u043b\u044f \u043c\u0443\u043b\u044c\u0442\u0438\u0432\u0430\u043b\u044e\u0442\u043d\u044b\u0445 \u0442\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0439.',
            keyboard: { inline_keyboard: [[{ text: '\u25c0\ufe0f \u041d\u0430\u0437\u0430\u0434', callback_data: `tx:v:${qeTx.id}${SF}` }]] },
          };
        }

        const { text, keyboard } = buildQuickEditAmountKb(qeTx.id, SF);
        await deleteSuccessCardW(telegramUserId, chatId);
        return { text, keyboard, editAmountBridge: { txId: qeTx.id } };
      }

      if (cmd === 'edit_category') {
        if (allCats.length === 0) {
          return {
            text: '\u26a0\ufe0f \u0412 \u0440\u0430\u0431\u043e\u0447\u0435\u043c \u043f\u0440\u043e\u0441\u0442\u0440\u0430\u043d\u0441\u0442\u0432\u0435 \u043d\u0435\u0442 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0439.',
            keyboard: { inline_keyboard: [[{ text: '\u25c0\ufe0f \u041d\u0430\u0437\u0430\u0434', callback_data: `tx:v:${qeTx.id}${SF}` }]] },
          };
        }

        const { text, keyboard } = buildQuickEditCategoryKb(
          qeTx.id, allCats, qeTx.category_name, SF,
        );
        await deleteSuccessCardW(telegramUserId, chatId);
        return { text, keyboard };
      }

      if (cmd === 'edit_account') {
        if (accounts.length === 0) {
          return {
            text: '\u26a0\ufe0f \u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u0441\u0447\u0435\u0442\u043e\u0432.',
            keyboard: { inline_keyboard: [[{ text: '\u25c0\ufe0f \u041d\u0430\u0437\u0430\u0434', callback_data: `tx:v:${qeTx.id}${SF}` }]] },
          };
        }

        const { text, keyboard } = buildQuickEditAccountKb(
          qeTx.id, accounts, qeTx.base_currency, SF,
        );
        await deleteSuccessCardW(telegramUserId, chatId);
        return { text, keyboard };
      }

      // edit_type
      const { text, keyboard } = buildQuickEditIntentKb(qeTx.id, SF);
      await deleteSuccessCardW(telegramUserId, chatId);
      return { text, keyboard };
    }
  }
}

// Minimal HTML escape for user-generated content in worker context
function escapeHtmlSimple(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}



// ─────────────────────────────────────────────────────────────
// Phase 2.3: STT transcript normalizer — crypto ticker fix
//
// Problem: xAI Grok STT transcribes spoken "USDT" as:
//   "юзд", "юздт", "юсдт", "usdt", "USD T", "US DT", "usd t" etc.
// Claude then maps "юзд" → USD (incorrect) per the prompt alias table.
//
// Solution: deterministic regex replacement BEFORE Claude sees the text.
// This is O(1), zero latency, zero LLM calls — the only right approach.
// ─────────────────────────────────────────────────────────────

const STT_CRYPTO_NORMALIZATIONS: Array<{ pattern: RegExp; replacement: string }> = [
  // ── USDT — must run BEFORE any USD rules ─────────────────────────────────
  // Standard phonetic variants: юздт, юсдт, юзд т, usdt, usd t, USD T
  { pattern: /\bюзд\s*т\b|\bюсд\s*т\b|\bюздт\b|\bюсдт\b/gi, replacement: 'USDT' },
  { pattern: /\busd\s*t\b|\bus\s*dt\b/gi,                       replacement: 'USDT' },
  { pattern: /\bтезер\b|\btether\b/gi,                           replacement: 'USDT' },

  // Letter-by-letter Russian pronunciation: у-эс-дэ-тэ / ю-эс-ди-ти
  { pattern: /\bу[\s\-]?эс[\s\-]?д[эe]?[\s\-]?т[эe]?\b/gi,   replacement: 'USDT' },
  { pattern: /\bю[\s\-]?эс[\s\-]?ди[\s\-]?ти\b/gi,             replacement: 'USDT' },

  // Partial drop: STT swallows final "т" → outputs "юсд" / "юзд" alone
  // Word-boundary lookAhead ensures we don't match inside longer Cyrillic words
  { pattern: /\bюсд(?=[^а-яёa-z]|$)/gi,                         replacement: 'USDT' },
  { pattern: /\bюзд(?=[^а-яёa-z]|$)/gi,                         replacement: 'USDT' },

  // USDC — similar phonetics
  { pattern: /\bюздс\b|\bюсдс\b|\busd\s*c\b/gi,                 replacement: 'USDC' },

  // BTC — "биток" already in prompt but add STT split variants
  { pattern: /\bbt\s*c\b|\bb\s*t\s*c\b/gi,                      replacement: 'BTC' },

  // ETH — "эфир" already in prompt; add STT split variants
  { pattern: /\be\s*t\s*h\b/gi,                                  replacement: 'ETH' },

  // TON — Telegram's own coin, common in CIS
  { pattern: /\bтон\s*коин\b|\bton\s*coin\b/gi,                  replacement: 'TON' },

  // SOL — Solana, often spoken as "сол" or "солана"
  { pattern: /\bсолана\b|\bsolana\b/gi,                           replacement: 'SOL' },

  // MATIC/POL — Polygon
  { pattern: /\bматик\b|\bполигон\b|\bpolygon\b/gi,               replacement: 'MATIC' },

  // XRP — Ripple
  { pattern: /\bрипл\b|\bripple\b/gi,                             replacement: 'XRP' },

  // TRX — Tron
  { pattern: /\bтрон\b(?!\s*(?:ов|ах|у|е|ом|ями))/gi,            replacement: 'TRX' },
];

// ── Context-aware USD → USDT upgrade ─────────────────────────────────────────
//
// Last-resort: if STT fully drops the final "T" and emits bare "USD",
// we can't distinguish it from a genuine USD transaction using text alone.
// Exception: if the phrase contains a known crypto exchange / wallet keyword
// (Bybit, Binance, кошелёк etc.), the intent is almost certainly USDT.
//
// Applied after STT_CRYPTO_NORMALIZATIONS, before Claude sees the text.
// SEC-12: no user text logged.
// ─────────────────────────────────────────────────────────────────────────────

const CRYPTO_PLATFORM_RE =
  /\b(bybit|byte?bit|binance|okx|kraken|huobi|kucoin|gate\.?io|mexc|bitget|trust\s*wallet|metamask|exodus|ledger|trezor|кошел[её]к|wallet|крипт[аоуе]|staking|стейкинг)\b/i;

/**
 * If the transcript already contains "USD" (not "USDT") and mentions a crypto
 * platform / wallet, upgrade all "USD" occurrences to "USDT".
 *
 * Example: "Перевёл 500 USD на Bybit" → "Перевёл 500 USDT на Bybit"
 * Safe: only fires when a clear crypto-context keyword is present.
 */
function upgradeCryptoContext(text: string): string {
  if (!CRYPTO_PLATFORM_RE.test(text)) return text;       // fast-path: no crypto context
  if (/\bUSDT\b/i.test(text)) return text;               // already USDT — skip
  return text.replace(/\bUSD\b/g, 'USDT');
}


// ─────────────────────────────────────────────────────────────
// Phase 2.7: STT spoken-number normalizer
//
// Problem: Voice input transcribes numbers as words:
//   "сто" → "100", "двести пятьдесят" → "250", "тысяча" → "1000"
// Without this, computeMissingFields() sees no digit → asks "Сколько?"
// even though the amount is clearly spoken.
//
// Strategy: single-pass greedy match of compound number words.
// Handles RU + UA phonetic variants (двохсот, п'ятдесят etc. handled
// by adding common Grok STT outputs for Ukrainian speech).
// ─────────────────────────────────────────────────────────────

/**
 * Map of spoken-number words → numeric values.
 * Ordered longest-first inside each tier to avoid partial matches.
 */
const SPOKEN_NUMBERS: Array<{ pattern: RegExp; value: number }> = [
  // Hundreds (compound: двести, triста etc. — must stay as single words, NOT split)
  { pattern: /\bдевятьсот\b/gi,      value: 900 },
  { pattern: /\bвосемьсот\b/gi,      value: 800 },
  { pattern: /\bвісімсот\b/gi,       value: 800 }, // UA
  { pattern: /\bсемьсот\b/gi,        value: 700 },
  { pattern: /\bшестьсот\b/gi,       value: 600 },
  { pattern: /\bпятьсот\b/gi,        value: 500 },
  { pattern: /\bп'?ятсот\b/gi,       value: 500 }, // UA
  { pattern: /\bчетыреста\b/gi,      value: 400 },
  { pattern: /\bчотириста\b/gi,      value: 400 }, // UA
  { pattern: /\bтриста\b/gi,         value: 300 },
  { pattern: /\bдвести\b|\bдвісті\b/gi, value: 200 },
  { pattern: /\bсто\b/gi,            value: 100 },

  // Tens
  { pattern: /\bдевяносто?\b/gi,     value: 90 },
  { pattern: /\bвосемьдесят\b/gi,    value: 80 },
  { pattern: /\bвісімдесят\b/gi,     value: 80 }, // UA
  { pattern: /\bсемьдесят\b/gi,      value: 70 },
  { pattern: /\bшестьдесят\b/gi,     value: 60 },
  { pattern: /\bпятьдесят\b/gi,      value: 50 },
  { pattern: /\bп'?ятдесят\b/gi,     value: 50 }, // UA
  { pattern: /\bсорок\b/gi,          value: 40 },
  { pattern: /\bтридцать\b|\bтридцять\b/gi, value: 30 },
  { pattern: /\bдвадцать\b|\bдвадцять\b/gi, value: 20 },

  // Teens (must be before single digits to avoid "один" matching in "одиннадцать")
  { pattern: /\bдевятнадцать\b|\bдев'?ятнадцять\b/gi, value: 19 },
  { pattern: /\bвосемнадцать\b|\bвісімнадцять\b/gi,    value: 18 },
  { pattern: /\bсемнадцать\b|\bсімнадцять\b/gi,        value: 17 },
  { pattern: /\bшестнадцать\b|\bшістнадцять\b/gi,      value: 16 },
  { pattern: /\bпятнадцать\b|\bп'?ятнадцять\b/gi,      value: 15 },
  { pattern: /\bчетырнадцать\b|\bчотирнадцять\b/gi,    value: 14 },
  { pattern: /\bтринадцать\b|\bтринадцять\b/gi,        value: 13 },
  { pattern: /\bдвенадцать\b|\bдванадцять\b/gi,        value: 12 },
  { pattern: /\bодиннадцать\b|\bодинадцять\b/gi,       value: 11 },
  { pattern: /\bдесять\b/gi,                           value: 10 },

  // Singles (last — most likely to false-positive)
  { pattern: /\bдевять\b|\bдев'?ять\b/gi,              value: 9 },
  { pattern: /\bвосемь\b|\bвісім\b/gi,                 value: 8 },
  { pattern: /\bсемь\b|\bсім\b/gi,                     value: 7 },
  { pattern: /\bшесть\b|\bшість\b/gi,                  value: 6 },
  { pattern: /\bпять\b|\bп'?ять\b/gi,                  value: 5 },
  { pattern: /\bчетыре\b|\bчотири\b/gi,                value: 4 },
  { pattern: /\bтри\b/gi,                              value: 3 },
  { pattern: /\bдва\b|\bдві\b|\bдвух\b/gi,             value: 2 },
  { pattern: /\bодин\b|\bодна\b|\bодно\b/gi,           value: 1 },
];

/**
 * Multiplicative scale words: N тысяч / N миллионов / N миллиардов.
 * These are replaced BEFORE SPOKEN_NUMBERS so "тысяч" doesn't become 1000
 * and then fail the descending-magnitude check in the aggregation pass.
 *
 * Examples:
 *   "10 тысяч"         → "10000"
 *   "полтора миллиона" → "1500000"  (handled separately below)
 *   "двадцать тысяч"   → after SPOKEN_NUMBERS pass: "20 тысяч" → "20000"
 *                        (the multiplicative pre-pass runs first as raw text)
 */
const MULTIPLICATIVE_PATTERNS: Array<{ pattern: RegExp; multiplier: number }> = [
  // миллиардов / млрд
  { pattern: /\b(\d+(?:[.,]\d+)?)\s*(?:миллиард(?:а|ов|ам|ами|ах)?|млрд\.?|мільярд(?:а|ів|ам|ами|ах)?)\b/gi, multiplier: 1_000_000_000 },
  // миллионов / млн
  { pattern: /\b(\d+(?:[.,]\d+)?)\s*(?:миллион(?:а|ов|ам|ами|ах)?|млн\.?|мільйон(?:а|ів|ам|ами|ах)?)\b/gi,  multiplier: 1_000_000 },
  // тысяч / тысячи / тыс
  { pattern: /\b(\d+(?:[.,]\d+)?)\s*(?:тысяч(?:а|и|у|ей|ам|ами|ах)?|тыс\.?|тисяч(?:а|і|у|ею|ами|ах)?|тис\.?)\b/gi, multiplier: 1_000 },
];

/**
 * Word-form multiplicative patterns (spoken digit word + scale word).
 * These run BEFORE SPOKEN_NUMBERS so the scale word isn't converted to a raw digit.
 * E.g. "двадцать тысяч" → "20000" (not "20 1000" which fails aggregation).
 */
const WORD_MULTIPLICATIVE_PATTERNS: Array<{ wordPattern: RegExp; multiplier: number }> = [
  // N тысяч(и) — word form, e.g. "двадцать тысяч", "пятьдесят тысяч"
  {
    wordPattern: /\b((?:девяносто?|восемьдесят|вісімдесят|семьдесят|шестьдесят|пятьдесят|п'?ятдесят|сорок|тридцать|тридцять|двадцать|двадцять|девятнадцать|дев'?ятнадцять|восемнадцать|вісімнадцять|семнадцать|сімнадцять|шестнадцать|шістнадцять|пятнадцать|п'?ятнадцять|четырнадцать|чотирнадцять|тринадцать|тринадцять|двенадцать|дванадцять|одиннадцать|одинадцять|десять|девять|дев'?ять|восемь|вісім|семь|сім|шесть|шість|пять|п'?ять|четыре|чотири|три|два|дві|двух|один|одна|одно)(?:\s+(?:девяносто?|восемьдесят|вісімдесят|семьдесят|шестьдесят|пятьдесят|п'?ятдесят|сорок|тридцать|тридцять|двадцать|двадцять))?)\s+тысяч(?:а|и|у|ей|ам|ами|ах)?\b/gi,
    multiplier: 1_000,
  },
  {
    wordPattern: /\b((?:девяносто?|восемьдесят|вісімдесят|семьдесят|шестьдесят|пятьдесят|п'?ятдесят|сорок|тридцать|тридцять|двадцать|двадцять|девятнадцать|дев'?ятнадцять|восемнадцать|вісімнадцять|семнадцать|сімнадцять|шестнадцать|шістнадцять|пятнадцать|п'?ятнадцять|четырнадцать|чотирнадцять|тринадцать|тринадцять|двенадцать|дванадцять|одиннадцать|одинадцять|десять|девять|дев'?ять|восемь|вісім|семь|сім|шесть|шість|пять|п'?ять|четыре|чотири|три|два|дві|двух|один|одна|одно)(?:\s+(?:девяносто?|восемьдесят|вісімдесят|семьдесят|шестьдесят|пятьдесят|п'?ятдесят|сорок|тридцать|тридцять|двадцать|двадцять))?)\s+тисяч(?:а|і|у|ею|ами|ах)?\b/gi,
    multiplier: 1_000,
  },
];

/**
 * Convert spoken-number words to digits in a transcript.
 *
 * Strategy: replace isolated number words one-by-one with their numeric
 * equivalents. Adjacent numbers are then summed by the following
 * aggregation pass (e.g. "двести пятьдесят" → "200 50" → "250").
 *
 * Note: only converts when the number word(s) appear adjacent to a
 * currency word or at the start of the amount position.
 * Avoids false positives like "три рубля" in "мы потратили три рубля"
 * — those still trigger correctly.
 *
 * SEC-12: text never logged here.
 */
function normalizeSpokenNumbers(text: string): string {
  let result = text;

  // ── Pass 0: collapse Russian space-formatted numbers ──────────────────
  // xAI STT ITN outputs "10 000 долларов" (space as thousands separator).
  // Without this pass, Pass 4 aggregation treats "10 000" as [10, 0] → sum=10.
  // Pattern: 1–3 leading digits followed by one or more exact 3-digit groups.
  // "10 000" → "10000", "100 000" → "100000", "1 000 000" → "1000000"
  result = result.replace(/\b(\d{1,3})(\s\d{3})+\b/g, (match) => match.replace(/\s/g, ''));

  // ── Pass 1: word-multiplicative pre-pass ───────────────────────────────
  // Handle "двадцать тысяч", "пятьдесят тысяч" BEFORE converting words to digits.
  // The regex captures the multiplied word(s) and multiplies by the scale.
  // Must run BEFORE SPOKEN_NUMBERS so scale words aren't converted to bare digits first.
  for (const { wordPattern, multiplier } of WORD_MULTIPLICATIVE_PATTERNS) {
    result = result.replace(wordPattern, (match, numWords: string) => {
      // Temporarily apply SPOKEN_NUMBERS to the captured word group to get its value
      let numStr = numWords;
      for (const { pattern, value } of SPOKEN_NUMBERS) {
        numStr = numStr.replace(pattern, String(value));
      }
      // Collapse any additive compound (e.g. "20 5" from "двадцать пять")
      const digits = numStr.trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
      if (digits.length === 0) return match;
      // Additive sum (must be descending)
      let sum = 0; let prev = Infinity; let ok = true;
      for (const d of digits) {
        if (d >= prev) { ok = false; break; }
        prev = d; sum += d;
      }
      if (!ok || sum <= 0) return match;
      return String(sum * multiplier);
    });
  }

  // ── Pass 2: digit-multiplicative pass ─────────────────────────────────
  // Handle "10 тысяч", "5 миллионов", "3.5 млн" — digit followed by scale word.
  // Must run BEFORE SPOKEN_NUMBERS (which would wrongly convert "тысяч" → 1000).
  for (const { pattern, multiplier } of MULTIPLICATIVE_PATTERNS) {
    result = result.replace(pattern, (_, numStr: string) => {
      const n = parseFloat(numStr.replace(',', '.'));
      if (isNaN(n) || n <= 0) return _;
      const product = Math.round(n * multiplier);
      if (product > 10_000_000_000) return _; // sanity cap
      return String(product);
    });
  }

  // ── Pass 3: spoken-word → digit replacement ────────────────────────────
  // Replace individual number words with their digit values.
  for (const { pattern, value } of SPOKEN_NUMBERS) {
    result = result.replace(pattern, String(value));
  }

  // ── Pass 4: additive aggregation ──────────────────────────────────────
  // Sum adjacent digit sequences for compound numbers: "200 50" → "250".
  // Only collapses descending-magnitude sequences (standard Russian compound numbers).
  result = result.replace(/\b(\d+)(\s+\d+)+\b/g, (match) => {
    const parts = match.split(/\s+/).map(Number);
    let sum = 0;
    let prevMagnitude = Infinity;
    let valid = true;
    for (const p of parts) {
      if (p >= prevMagnitude) { valid = false; break; }
      prevMagnitude = p;
      sum += p;
    }
    if (valid && sum > 0 && sum <= 10_000_000) return String(sum);
    return match;
  });

  return result;
}

/**
 * Normalize crypto ticker phonetic transcriptions + spoken numbers in a raw STT transcript.
 *
 * Runs deterministic regex replacements BEFORE Claude sees the text.
 * Preserves all other words and numbers unchanged.
 *
 * SEC-12: input/output text NEVER logged — caller's responsibility.
 */
function normalizeSttTranscript(transcript: string): string {
  let result = transcript;
  // Pass 1: crypto tickers (юсдт → USDT, юзд → USDT, etc.)
  for (const { pattern, replacement } of STT_CRYPTO_NORMALIZATIONS) {
    result = result.replace(pattern, replacement);
  }
  // Pass 1.5: context-aware USD → USDT upgrade
  // If transcript still contains plain "USD" but mentions a crypto platform,
  // STT likely dropped the final "T" entirely — upgrade to USDT.
  result = upgradeCryptoContext(result);
  // Pass 2: spoken numbers → digits
  result = normalizeSpokenNumbers(result);
  return result;
}



// ─────────────────────────────────────────────────────────────
// UX message templates
// ─────────────────────────────────────────────────────────────

const VOICE_ERROR_EMPTY_TEXT =
  '😕 <b>Не смог разобрать голосовое.</b>\n\n' +
  'Возможные причины:\n' +
  '• Слишком тихо или шумно вокруг\n' +
  '• Слишком короткое сообщение\n\n' +
  'Попробуй ещё раз или напиши текстом 👇';

const VOICE_ERROR_API_TEXT =
  '⚠️ <b>Сервис распознавания временно недоступен.</b>\n\n' +
  'Напиши транзакцию текстом — я точно пойму!';

const VOICE_ERROR_DOWNLOAD_TEXT =
  '⚠️ <b>Не смог загрузить голосовое сообщение.</b>\n\n' +
  'Попробуй ещё раз или напиши текстом 👇';

// ─────────────────────────────────────────────────────────────
// Redis key helpers
// ─────────────────────────────────────────────────────────────

/** Tracks consecutive voice failures per user (for UX degradation) */
function voiceFailKey(telegramUserId: string, chatId: string): string {
  return `midas:voice:fail:${telegramUserId}:${chatId}`;
}

/**
 * Stores the ID of the last STT error message.
 * Read and deleted by the webhook when the user sends the next voice.
 * TTL: 24h (error messages older than that can't be deleted by Telegram anyway).
 */
function voiceErrMsgKey(telegramUserId: string, chatId: string): string {
  return `midas:voice:err:msg:${telegramUserId}:${chatId}`;
}

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processVoiceParse(job: Job<VoiceParseJobPayload>): Promise<void> {
  // Top-level guard: if anything throws unexpectedly, edit the status
  // message so the user never sees a frozen "⏳ Распознаю..." forever.
  // SEC-12: errors logged without transcript content.
  try {
    return await _processVoiceParse(job);
  } catch (err) {
    const statusMsgId = job.data.statusMessageId;
    const chatId      = job.data.chatId;
    console.error('[midas:voice-parse-worker] Unhandled error — editing status msg', {
      jobId: job.id,
      workspaceId: job.data.workspaceId,
      errorClass: err instanceof Error ? err.constructor.name : 'Unknown',
    });
    if (statusMsgId && chatId) {
      await editStatusMessage(chatId, statusMsgId, VOICE_ERROR_API_TEXT);
    }
    throw err; // re-throw so BullMQ marks the job as failed & retries
  }
}

async function _processVoiceParse(job: Job<VoiceParseJobPayload>): Promise<void> {
  const { botId, chatId, messageId, telegramUserId, workspaceId, userId, fileId, duration, statusMessageId } = job.data;

  console.log('[midas:voice-parse-worker] Processing job', {
    jobId: job.id,
    workspaceId,
    telegramUserId,
    duration,
    hasUserId: !!userId, // Phase 2S2: userId is used in Phase 2.1 voice command execution
    // fileId and statusMessageId are operational metadata — safe to log (no user text)
  });

  const failKey = voiceFailKey(telegramUserId, chatId);

  // ── Step 1: Get Telegram file path ────────────────────────
  const filePath = await getTelegramFilePath(fileId);
  if (!filePath) {
    console.warn('[midas:voice-parse-worker] Failed to get file_path from Telegram', {
      jobId: job.id, workspaceId,
    });
    await editStatusMessage(chatId, statusMessageId, VOICE_ERROR_DOWNLOAD_TEXT);
    await redisConnection.incr(failKey);
    await redisConnection.expire(failKey, 3600);
    return;
  }

  // ── Step 2: Download OGG buffer ────────────────────────────
  const audioBuffer = await downloadTelegramFile(filePath);
  if (!audioBuffer) {
    console.warn('[midas:voice-parse-worker] Failed to download audio buffer', {
      jobId: job.id, workspaceId,
    });
    await editStatusMessage(chatId, statusMessageId, VOICE_ERROR_DOWNLOAD_TEXT);
    await redisConnection.incr(failKey);
    await redisConnection.expire(failKey, 3600);
    return;
  }

  // ── Step 3: xAI Grok STT ─────────────────────────────────
  // Extract filename from filePath (e.g. "voice/file_1.oga" → "voice.ogg")
  const ext = filePath.split('.').pop() ?? 'ogg';
  const filename = `voice.${ext}`;

  const sttResult = await transcribeVoice(audioBuffer, filename, 'ru');
  // SEC-12: sttResult.text NEVER logged below

  // ── Step 4a: Handle STT failures ──────────────────────────
  if (sttResult.status === 'empty') {
    console.log('[midas:voice-parse-worker] STT returned empty — silent or noise audio', {
      jobId: job.id, workspaceId,
    });
    await editStatusMessage(chatId, statusMessageId, VOICE_ERROR_EMPTY_TEXT);
    // Store error message ID so next voice attempt deletes it
    void redisConnection.set(voiceErrMsgKey(telegramUserId, chatId), statusMessageId, 'EX', 86400);

    // Increment failure counter — suggest text input after 3 failures
    const failCount = await redisConnection.incr(failKey);
    await redisConnection.expire(failKey, 3600);

    if (failCount >= 3) {
      const exhaustedText =
        '😊 <b>Похоже, голосом пока не получается.</b>\n\n' +
        'Попробуй написать текстом — я точно пойму что нужно сделать.';
      await editStatusMessage(chatId, statusMessageId, exhaustedText);
      void redisConnection.del(failKey); // reset counter
    }
    return;
  }

  if (sttResult.status === 'error') {
    console.warn('[midas:voice-parse-worker] STT API error', {
      jobId: job.id, workspaceId,
      reason: sttResult.reason, // reason is system message, not user text — safe
    });
    await editStatusMessage(chatId, statusMessageId, VOICE_ERROR_API_TEXT);
    // Store error message ID so next voice attempt deletes it
    void redisConnection.set(voiceErrMsgKey(telegramUserId, chatId), statusMessageId, 'EX', 86400);
    // Don't increment failure counter for API errors — not user's fault
    return;
  }

  // ── Step 4b: STT succeeded ────────────────────────────────
  // Reset consecutive failure counter
  void redisConnection.del(failKey);

  // SEC-12: transcript exists in sttResult.text — NEVER log it
  // Phase 2.3: normalize crypto tickers BEFORE ai-parse sees the text.
  // e.g. "купил куртку за 300 юзд" → "купил куртку за 300 USDT"
  const transcript = normalizeSttTranscript(sttResult.text);

  // ── Phase 2S2: Voice command detection + DIRECT execution ──
  // Replaces old Phase 2.2 "Нажми кнопку" approach.
  // Now commands are executed inline — balance screen, settings, etc.
  const voiceCmd = detectCommand(transcript);
  // Debug: log command detection result + transcript prefix for troubleshooting
  // SEC-12: only prefix logged — no amounts, names, or financial data exposed
  console.log('[midas:voice-parse-worker] Phase 2S2: detectCommand result', {
    jobId: job.id, workspaceId, voiceCmd,
    transcriptPrefix: transcript.slice(0, 40),
  });
  if (voiceCmd) {

    // ── Blindspot 2: Redis state collision check ──
    // If user is mid-flow (onboarding, clarification, etc.),
    // skip nav command → fall through to AI parse.
    const stateKeys = [
      `midas:ac:${telegramUserId}:${chatId}`,        // account onboarding
      `midas:clar:${telegramUserId}:${chatId}`,       // AI clarification
      `midas:edit:${telegramUserId}:${chatId}`,       // edit-amount waiting
      `midas:settings:search:${telegramUserId}:${chatId}`, // settings search
      `midas:xfx:ptr:${telegramUserId}:${chatId}`,    // cross-currency exchange
    ];
    let hasActiveState = false;
    try {
      const pipeline = redisConnection.pipeline();
      for (const key of stateKeys) pipeline.exists(key);
      const results = await pipeline.exec();
      if (results) {
        hasActiveState = results.some(([err, val]) => !err && val === 1);
      }
      // DEBUG: log which keys are active
      console.log('[midas:voice-parse-worker] DEBUG state-gate', {
        jobId: job.id, voiceCmd, hasActiveState,
        keys: results?.map(([_e, val], i) => ({ key: stateKeys[i]?.split(':')[1], exists: val === 1 })),
      });
    } catch (sgErr: unknown) {
      console.warn('[midas:voice-parse-worker] DEBUG state-gate Redis error', { error: sgErr instanceof Error ? (sgErr as Error).message : 'unknown' });
      // Non-fatal: if Redis fails, proceed with nav (better UX)
    }

    const isQuickEditCmd = voiceCmd === 'edit_amount' || voiceCmd === 'edit_category' ||
      voiceCmd === 'edit_account' || voiceCmd === 'edit_type';
    console.log('[midas:voice-parse-worker] DEBUG gate decision', {
      jobId: job.id, voiceCmd, hasActiveState, isQuickEditCmd,
      willExecute: !(hasActiveState && !isQuickEditCmd),
    });
    if (hasActiveState && !isQuickEditCmd) {
      console.log('[midas:voice-parse-worker] Phase 2S2: active state detected, skipping nav', {
        jobId: job.id, workspaceId, voiceCmd,
      });
      // Fall through to AI parse path below
    } else {
      // ── Blindspot 3: Nav dedup (2s TTL) ──
      const dedupKey = `midas:nav:dedup:${telegramUserId}:${chatId}`;
      let isDuplicate = false;
      try {
        const set = await redisConnection.set(dedupKey, '1', 'EX', 2, 'NX');
        isDuplicate = set === null; // NX returns null if key already exists
      } catch {
        // Non-fatal: proceed without dedup
      }

      if (isDuplicate) {
        console.log('[midas:voice-parse-worker] Phase 2S2: nav dedup — duplicate within 2s', {
          jobId: job.id, workspaceId, voiceCmd,
        });
        // Just delete the status message and bail
        await editStatusMessage(chatId, statusMessageId, '✅ Готово');
        return;
      }

      // ── Direct execution: build nav screen inline ──
      // Blindspot 4: Can't import from telegram-bot — minimal SQL queries inlined.
      try {
        console.log('[midas:voice-parse-worker] DEBUG calling buildVoiceNavResponse', { jobId: job.id, voiceCmd, workspaceId });
        const navResult = await buildVoiceNavResponse(voiceCmd, workspaceId, userId, telegramUserId, chatId);
        console.log('[midas:voice-parse-worker] DEBUG navResult', { jobId: job.id, hasResult: !!navResult, hasText: !!navResult?.text });
        if (navResult) {
          // Phase 2 Point 2.1: Delete previous nav screen before showing the new one.
          // Without this, consecutive voice commands accumulate nav screens in the chat.
          // Mirrors the identical cleanup at lines ~1717-1751 (ai-parse path).
          try {
            const oldNavKey = `midas:nav:${telegramUserId}:${chatId}`;
            const lcKeyP2 = `midas:last_confirmed:${telegramUserId}:${chatId}`;
            // Read both keys in one pipeline to minimise round-trips
            const [[, oldNavMsgId], [, lastConfirmedId]] = await redisConnection.pipeline()
              .get(oldNavKey)
              .get(lcKeyP2)
              .exec() as [[null, string | null], [null, string | null]];

            if (
              oldNavMsgId &&                           // there IS a previous nav screen
              oldNavMsgId !== statusMessageId &&        // it is NOT the current "⏳" (same-msg edit)
              oldNavMsgId !== lastConfirmedId           // it is NOT the success card (✅ Записано)
            ) {
              const tok = process.env.TELEGRAM_BOT_TOKEN;
              if (tok) {
                void fetch(`${TELEGRAM_API_BASE}/bot${tok}/deleteMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: chatId, message_id: parseInt(oldNavMsgId, 10) }),
                });
              }
              void redisConnection.del(oldNavKey);
            }
          } catch { /* non-fatal — nav cleanup is best-effort */ }

          // Replace "⏳ Распознаю..." with the actual nav screen
          await editStatusMessage(chatId, statusMessageId, navResult.text, navResult.keyboard);

          // Phase 5.3 Point 1.2: Cleanup previous floating "🤔" card if exists
          try {
            const prevClarKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
            const prevClarMsgId = await redisConnection.get(prevClarKey);
            if (prevClarMsgId && prevClarMsgId !== statusMessageId) {
              const tok = process.env.TELEGRAM_BOT_TOKEN;
              if (tok) {
                void fetch(`${TELEGRAM_API_BASE}/bot${tok}/deleteMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: chatId, message_id: parseInt(prevClarMsgId, 10) }),
                });
              }
              void redisConnection.del(prevClarKey);
            }
          } catch { /* non-fatal */ }

          // FIX: Clear stale clarification state gate to prevent text intercept collision.
          // Without this, midas:clar: from a previous failed voice attempt intercepts
          // the user's next text BEFORE midas:tx:edit:amt gets a chance (Step 5f-clar
          // runs before Step 5g-tx-edit in webhook.route.ts).
          void redisConnection.del(`midas:clar:${telegramUserId}:${chatId}`);

          // Register nav pointer in midas:nav:
          const navRedisKey = `midas:nav:${telegramUserId}:${chatId}`;
          void redisConnection.set(navRedisKey, statusMessageId, 'EX', 86400);

          // Fix 3: edit_amount Redis bridge
          if (navResult.editAmountBridge) {
            try {
              await redisConnection.set(
                `midas:tx:edit:amt:${telegramUserId}:${chatId}`,
                `${navResult.editAmountBridge.txId}:${statusMessageId}:s`,
                'EX', 300,
              );
            } catch { /* non-fatal */ }
          }

          console.log('[midas:voice-parse-worker] DEBUG quick-edit SUCCESS — returning', { jobId: job.id, voiceCmd });
          return;
        }
        // navResult === null means we can't handle this command (e.g. 'transactions')
        console.log('[midas:voice-parse-worker] DEBUG navResult null — falling through to AI parse', { jobId: job.id, voiceCmd });
      } catch (err) {
        const isQuickEdit = voiceCmd === 'edit_amount' || voiceCmd === 'edit_category' ||
          voiceCmd === 'edit_account' || voiceCmd === 'edit_type';
        console.error('[midas:voice-parse-worker] Phase 2S2: nav execution failed', {
          jobId: job.id, workspaceId, voiceCmd, isQuickEdit,
          error: err instanceof Error ? err.message : 'unknown',
        });
        if (isQuickEdit) {
          // Quick-edit failed but card was NOT deleted (delete-after-build pattern).
          // Show friendly error instead of falling to AI parse.
          try {
            await editStatusMessage(chatId, statusMessageId,
              '\u26a0\ufe0f \u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u043d\u0430\u0436\u0430\u0442\u044c \u270f\ufe0f \u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u0437\u0430\u043f\u0438\u0441\u044c.');
          } catch { /* non-fatal */ }
          return;
        }
        // Non-edit commands: fall through to AI parse — graceful degradation
      }
    }
  }

  // ── Phase 2S2+: Delete previous nav message before transaction card ──
  // If the user had a nav panel open (balance, settings, help, etc. triggered
  // by voice or text), delete it now so the transaction card appears cleanly.
  // This mirrors the logic in upsertBotMessage (active-message.service.ts L213-218)
  // which runs for TEXT transactions. For VOICE transactions we do it here because
  // the voice worker bypasses the webhook route where that cleanup normally fires.
  try {
    const navRedisKey = `midas:nav:${telegramUserId}:${chatId}`;
    const oldNavMsgId = await redisConnection.get(navRedisKey);
    if (oldNavMsgId) {
      const lcKey = `midas:last_confirmed:${telegramUserId}:${chatId}`;
      const lastConfirmedMsgId = await redisConnection.get(lcKey);
      if (oldNavMsgId === lastConfirmedMsgId) {
        // Success card — just clear stale nav pointer, DON'T delete message
        void redisConnection.del(navRedisKey);
      } else {
        // Actual nav screen — safe to delete
        void (async () => {
          try {
            const token = process.env.TELEGRAM_BOT_TOKEN;
            if (token) {
              await fetch(`${TELEGRAM_API_BASE}/bot${token}/deleteMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, message_id: parseInt(oldNavMsgId, 10) }),
              });
            }
          } catch { /* silent */ }
        })();
        void redisConnection.del(navRedisKey);
      }
    }
  } catch {
    // Non-fatal: cleanup is best-effort
  }

  // ── Step 5: Store status msgId → ai-parse will delete it ──
  // The ai-parse.worker reads `midas:clar:msg:{uid}:{cid}` and passes it
  // as `deleteMessageId` when the draft card is sent. This makes the
  // "⏳ Распознаю..." message disappear exactly when the card appears.
  const clarMsgKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
  // Phase 5.3 Point 1.1: Read OLD value before overwriting — delete orphaned "🤔" card
  try {
    const prevFailedMsgId = await redisConnection.get(clarMsgKey);
    if (prevFailedMsgId && prevFailedMsgId !== statusMessageId) {
      const tok = process.env.TELEGRAM_BOT_TOKEN;
      if (tok) {
        void fetch(`${TELEGRAM_API_BASE}/bot${tok}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, message_id: parseInt(prevFailedMsgId, 10) }),
        });
      }
    }
  } catch { /* non-fatal */ }
  try {
    await redisConnection.set(clarMsgKey, statusMessageId, 'EX', 600);
  } catch {
    // Non-fatal: if this fails, the "⏳" message stays but UX still works
  }

  // ── Step 6: Re-enqueue as ai-parse job ───────────────────
  // raw_text = Whisper transcript. The entire existing ai-parse.worker flow
  // handles draft creation, account picker, and confirmation — zero duplication.
  const aiParsePayload: AiParseJobPayload = {
    botId,
    messageId,
    chatId,
    telegramUserId,
    workspaceId,
    raw_text: transcript, // SEC-12: stored in job payload, never logged
    receivedAt: job.data.receivedAt,
  };

  // NOTE: BullMQ prohibits colons in custom job IDs.
  // IdempotencyKeyBuilder.aiParse uses ':' separators → crashes here.
  // Voice jobs are already deduplicated at the webhook level (voiceParse key),
  // so we use a plain ULID for the downstream ai-parse job.
  const aiJobId = ulid();
  await aiParseQueue.add(QUEUE_NAMES.AI_PARSE, aiParsePayload, { jobId: aiJobId });

  console.log('[midas:voice-parse-worker] Transcript enqueued to ai-parse', {
    jobId: job.id,
    workspaceId,
    aiJobId,
    // transcript NOT logged (SEC-12)
  });
}

// ─────────────────────────────────────────────────────────────
// Worker instantiation
// ─────────────────────────────────────────────────────────────

export function createVoiceParseWorker(): Worker<VoiceParseJobPayload> {
  const worker = new Worker<VoiceParseJobPayload>(
    QUEUE_NAMES.VOICE_PARSE,
    processVoiceParse,
    {
      connection: redisConnection,
      prefix: 'bull',
      concurrency: 3,
      // xAI Grok STT rate limit is generous — 3 concurrent workers is well within budget.
    },
  );

  worker.on('completed', (job: Job<VoiceParseJobPayload>) => {
    console.log('[midas:voice-parse-worker] Job completed', {
      jobId: job.id,
      workspaceId: job.data.workspaceId,
      duration: job.data.duration,
    });
  });

  worker.on('failed', (job: Job<VoiceParseJobPayload> | undefined, err: Error) => {
    console.error('[midas:voice-parse-worker] Job failed', {
      jobId: job?.id ?? 'unknown',
      workspaceId: job?.data.workspaceId,
      errorClass: err.constructor.name,
      attemptsMade: job?.attemptsMade,
    });
  });

  return worker;
}
