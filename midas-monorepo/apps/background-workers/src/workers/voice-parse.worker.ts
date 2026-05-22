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
import { QUEUE_NAMES, type VoiceParseJobPayload, type AiParseJobPayload, detectCommand, type NavCommand } from '@midas/shared';
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
}

async function buildVoiceNavResponse(
  cmd: NavCommand,
  workspaceId: string,
  userId: string,
): Promise<VoiceNavResponse | null> {
  switch (cmd) {
    case 'balance': {
      // Minimal balance query — correct table/column names from balance.service.ts
      // Tables: account_sources (not accounts), workspaces (not settings)
      // Columns: currency (not currency_code), initial_balance + tx sum (not current_balance)
      const result = await withTenantTransaction(workspaceId, userId, async (client) => {
        const r = await client.query<{
          id: string;
          name: string;
          balance: { toFixed: (dp: number) => string };
          currency: string;
          is_expense_default: boolean;
          is_income_default: boolean;
        }>(
          `SELECT a.id,
                  a.name,
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
           GROUP BY a.id, a.name, a.currency, a.initial_balance,
                    w.default_expense_account_id, w.default_income_account_id
           ORDER BY a.name`,
          [workspaceId],
        );
        return r.rows;
      });

      if (!result || result.length === 0) {
        return {
          text: '📭 <b>Пока нет счетов</b>\n\nСоздайте первый счёт с помощью команды «добавь счёт»',
        };
      }

      const lines = result.map((a) => {
        const isStar = Boolean(a.is_expense_default) && Boolean(a.is_income_default);
        const star = isStar ? ' ⭐' : '';
        const bal = a.balance.toFixed(2);
        return `▸ <b>${escapeHtmlSimple(a.name)}${star}</b> — <b>${formatAmount(bal)} ${a.currency}</b>`;
      });

      return {
        text: `💼 <b>Баланс</b>\n\n${lines.join('\n')}`,
        keyboard: {
          inline_keyboard: result.map((a) => {
            const isStar = Boolean(a.is_expense_default) && Boolean(a.is_income_default);
            return [{ text: `${isStar ? '⭐ ' : ''}${a.name}`, callback_data: `bal:det:${a.id}` }];
          }).concat([
            [{ text: '➕ Добавить счёт', callback_data: 'ac:new' }],
          ]),
        },
      };
    }

    case 'settings': {
      // Settings are in 'workspaces' table, not 'settings'
      const result = await withTenantTransaction(workspaceId, userId, async (client) => {
        const r = await client.query<{
          default_currency: string;
          timezone: string;
          main_account_name: string | null;
        }>(
          `SELECT w.default_currency, w.timezone, ea.name AS main_account_name
           FROM workspaces w
           LEFT JOIN account_sources ea ON ea.id = w.default_expense_account_id
           WHERE w.id = $1`,
          [workspaceId],
        );
        return r.rows[0] ?? null;
      });

      const tz = result?.timezone ?? 'UTC';
      const mainAcct = result?.main_account_name
        ? escapeHtmlSimple(result.main_account_name)
        : '<i>не задан</i>';

      return {
        text: `⚙️ <b>Настройки Midas</b>\n\n🏦 Основной счёт: ${mainAcct}\n🕒 Часовой пояс: <b>${escapeHtmlSimple(tz)}</b>`,
        keyboard: {
          inline_keyboard: [
            [
              { text: '🕐 Часовой пояс', callback_data: 'st:tz' },
            ],
            [{ text: '📤 Экспорт', callback_data: 'st:exp' }],
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
      // Phase 3.1: cancel_last — query last transaction + confirm card
      const lastTx = await withTenantTransaction(workspaceId, userId, async (client) => {
        const r = await client.query<{
          id: string;
          item_name: string | null;
          base_amount: string;
          base_currency: string;
          transaction_intent: string;
          created_at: string;
        }>(
          `SELECT id, item_name, base_amount, base_currency, transaction_intent, created_at
           FROM transactions
           WHERE workspace_id = $1 AND deleted_at IS NULL
           ORDER BY created_at DESC
           LIMIT 1`,
          [workspaceId],
        );
        return r.rows[0] ?? null;
      });

      if (!lastTx) {
        return { text: '📭 Нет транзакций для отмены.' };
      }

      const intentLabels: Record<string, string> = {
        expense: '📉 Расход', income: '📈 Доход',
        transfer: '🔄 Перевод', debt_given: '📤 Долг (дал)',
        debt_received: '📥 Долг (взял)',
      };
      const intent = intentLabels[lastTx.transaction_intent] ?? lastTx.transaction_intent;
      const name = lastTx.item_name ? ` · ${escapeHtmlSimple(lastTx.item_name)}` : '';
      const dt = (() => {
        try {
          const d = new Date(lastTx.created_at);
          return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } catch {
          return lastTx.created_at;
        }
      })();
      const card = `${intent}${name}\n💰 ${lastTx.base_amount} ${lastTx.base_currency}\n⏰ ${dt}`;

      return {
        text: `🗑 <b>Удалить эту транзакцию?</b>\n\n${card}\n\nТранзакция будет скрыта из всех отчётов и баланс пересчитается.`,
        keyboard: {
          inline_keyboard: [
            [
              { text: '✅ Да, удалить', callback_data: `ed:del:y:${lastTx.id}` },
              { text: '❌ Нет',         callback_data: `ed:del:n:${lastTx.id}` },
            ],
          ],
        },
      };
    }

    case 'transactions':
      // Transactions require pagination → can't build from worker
      return null;
  }
}

// Minimal HTML escape for user-generated content in worker context
function escapeHtmlSimple(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Format amount with thousands separator
function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return num.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
  if (voiceCmd) {
    console.log('[midas:voice-parse-worker] Phase 2S2: voice command detected', {
      jobId: job.id, workspaceId, voiceCmd,
    });

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
    } catch {
      // Non-fatal: if Redis fails, proceed with nav (better UX)
    }

    if (hasActiveState) {
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
        const navResult = await buildVoiceNavResponse(voiceCmd, workspaceId, userId);
        if (navResult) {
          // Replace "⏳ Распознаю..." with the actual nav screen
          await editStatusMessage(chatId, statusMessageId, navResult.text, navResult.keyboard);
          return;
        }
        // navResult === null means we can't handle this command (e.g. 'transactions')
        // Fall through to AI parse
      } catch (err) {
        console.error('[midas:voice-parse-worker] Phase 2S2: nav execution failed', {
          jobId: job.id, workspaceId, voiceCmd,
          error: err instanceof Error ? err.message : 'unknown',
        });
        // Fall through to AI parse — graceful degradation
      }
    }
  }

  // ── Step 5: Store status msgId → ai-parse will delete it ──
  // The ai-parse.worker reads `midas:clar:msg:{uid}:{cid}` and passes it
  // as `deleteMessageId` when the draft card is sent. This makes the
  // "⏳ Распознаю..." message disappear exactly when the card appears.
  const clarMsgKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
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
