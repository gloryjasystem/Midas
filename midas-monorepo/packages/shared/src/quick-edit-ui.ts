/**
 * Quick Edit UI Builders — Phase 5.1-Pre
 *
 * Pure keyboard-building functions for the "Context-Aware Quick Edits" flow.
 * These are the SINGLE SOURCE OF TRUTH for all 4 quick-edit pickers:
 *   - Amount (sends "✏️ Введите новую сумму:")
 *   - Category (sends full Phase 4.0 grouped picker)
 *   - Account (sends picker with 🏦/⚠️ currency indicators)
 *   - Intent/Type (sends 5-button type picker)
 *
 * Design constraints (strict):
 *   - ZERO I/O — no DB queries, no Redis, no Telegram API calls.
 *   - ZERO external dependencies — only imports from within @midas/shared.
 *   - Accepts raw data as arguments, returns { text, keyboard } structure.
 *   - Usable in BOTH webhook.route.ts (sync) and voice-parse.worker.ts (async).
 *
 * Callback_data format: all buttons use the provided `backSuffix`.
 *   Phase 5.0 uses ':s' (standalone) so ◀️ Назад → tx:v:{txId}:s → ✖️ Закрыть.
 *
 * SEC-12: does not log any values.
 * SEC-02: account balance formatting uses integer arithmetic only.
 */

import { getCategoryEmoji } from './category-emoji.js';
import { escapeHtml } from './html-escape.js';

// ─────────────────────────────────────────────────────────────
// Shared types — minimal projections, app-agnostic
// ─────────────────────────────────────────────────────────────

/** Minimal category representation needed by quick-edit pickers. */
export interface QECategoryInfo {
  id: string;
  name: string;
  /** Category group ('Жизнь' | 'Бизнес' | null for custom) */
  group: string | null;
  /** DB emoji for custom categories; null for standard */
  icon: string | null;
  /** true = user-created; false = standard (seeded) */
  is_custom: boolean;
}

/** Minimal account representation needed by quick-edit pickers. */
export interface QEAccountInfo {
  id: string;
  name: string;
  currency: string;
  /** NUMERIC string — SEC-02: never parsed with parseFloat/Number() */
  balance: string;
}

/** Return type for all builder functions — directly usable as Telegram message payload. */
export interface QEKeyboardResult {
  /** HTML-formatted message text (safe to pass as parse_mode:'HTML') */
  text: string;
  /** InlineKeyboardMarkup-compatible structure */
  keyboard: {
    inline_keyboard: { text: string; callback_data: string }[][];
  };
}

// ─────────────────────────────────────────────────────────────
// EDITABLE_INTENTS — moved here as single source of truth
// Mirrors edit.service.ts to avoid cross-app import.
// ─────────────────────────────────────────────────────────────

export const QE_EDITABLE_INTENTS = [
  'income',
  'expense',
  'debt_given',
  'debt_received',
  'transfer',
] as const;

export type QETransactionIntent = typeof QE_EDITABLE_INTENTS[number];

// ─────────────────────────────────────────────────────────────
// Internal helpers (pure, not exported)
// ─────────────────────────────────────────────────────────────

/**
 * Format account balance string for display in picker buttons.
 * SEC-02: integer arithmetic only — no parseFloat / Number().
 * Strips trailing decimal zeros, adds thin-space (U+202F) thousand separator.
 *
 * Examples:
 *   "350.00" → "350"
 *   "1500.5" → "1500.5"
 *   "2100.123" → "2100.12"  (2 decimal max)
 *   "-250" → "−250"  (proper minus sign U+2212)
 */
function fmtBalance(balStr: string): string {
  if (!balStr || balStr === '0') return '0';
  const isNeg = balStr.startsWith('-');
  const abs = isNeg ? balStr.slice(1) : balStr;
  const dotIdx = abs.indexOf('.');
  const intPart  = dotIdx === -1 ? abs : abs.slice(0, dotIdx);
  const fracFull = dotIdx === -1 ? '' : abs.slice(dotIdx + 1);
  const fracTrim = fracFull.replace(/0+$/, ''); // strip trailing zeros
  const intSep   = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F'); // thin space
  const formatted = fracTrim ? `${intSep}.${fracTrim}` : intSep;
  return isNeg ? `\u2212${formatted}` : formatted; // proper minus sign
}

// ─────────────────────────────────────────────────────────────
// Builder 1: Amount Picker
// ─────────────────────────────────────────────────────────────

/**
 * Build the Amount edit picker.
 *
 * Renders a single-button message asking the user to type a new amount.
 * The caller is responsible for:
 *   - Sending this as a NEW message (not editing an existing one) to capture sentMsgId.
 *   - Writing sentMsgId to Redis key midas:tx:edit:amt for the text intercept.
 *
 * @param txId       - Transaction ULID (26 chars)
 * @param backSuffix - Suffix appended to all callback_data (e.g. ':s' for standalone)
 *
 * @example
 * buildQuickEditAmountKb('01HX...', ':s')
 * // → { text: '✏️ Введите новую сумму:', keyboard: [[◀️ Отмена → tx:v:{txId}:s]] }
 */
export function buildQuickEditAmountKb(
  txId: string,
  backSuffix: string,
): QEKeyboardResult {
  return {
    text: '✏️ Введите новую сумму:',
    keyboard: {
      inline_keyboard: [
        [{ text: '◀️ Отмена', callback_data: `tx:v:${txId}${backSuffix}` }],
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Builder 2: Category Picker (Phase 4.0 full UI — pixel-perfect)
// ─────────────────────────────────────────────────────────────

/**
 * Build the Category picker — exact Phase 4.0 UI.
 *
 * Layout:
 *   Row 0:    [✨ {currentCat}]          ← if currentCat found (AI hint row)
 *   Rows 1-N: flat list (2/row)          ← if useFlat (≤6 standard OR only 1 group)
 *           OR [🛒 Жизнь] [💼 Бизнес]   ← group tabs (>6 standard AND both groups exist)
 *   Row N+1:  [⭐ Мои (N)]               ← if customCats.length > 0
 *   Row N+2:  [✏️ Создать]
 *   Row N+3:  [◀️ Назад]
 *
 * The flat/group decision mirrors handleQuickEditField in webhook.route.ts:
 *   useFlat = standardCats.length <= 6 || lifeCats.length === 0 || bizCats.length === 0
 *
 * @param txId                - Transaction ULID
 * @param allCats             - All categories for the workspace (from getWorkspaceCategories)
 * @param currentCategoryName - Current category name of the transaction (null if unknown)
 * @param backSuffix          - Callback suffix (e.g. ':s')
 */
export function buildQuickEditCategoryKb(
  txId: string,
  allCats: QECategoryInfo[],
  currentCategoryName: string | null,
  backSuffix: string,
): QEKeyboardResult {
  // ── Partition categories ─────────────────────────────────────────────────
  const currentCat   = currentCategoryName
    ? (allCats.find(c => c.name === currentCategoryName) ?? null)
    : null;
  const standardCats = allCats.filter(c => !c.is_custom);
  const lifeCats     = standardCats.filter(c => c.group === 'Жизнь');
  const bizCats      = standardCats.filter(c => c.group === 'Бизнес');
  const customCats   = allCats.filter(c => c.is_custom === true);

  // ── Flat vs grouped display decision ────────────────────────────────────
  // Flat when: fewer than 7 standard categories OR only one group exists.
  const useFlat = standardCats.length <= 6 || lifeCats.length === 0 || bizCats.length === 0;

  const rows: { text: string; callback_data: string }[][] = [];

  // ── Row 0: ✨ Current category (AI hint) ─────────────────────────────────
  if (currentCat) {
    rows.push([{
      text: `✨ ${getCategoryEmoji(currentCat.name, currentCat.icon)} ${currentCat.name}`,
      callback_data: `tx:c:cat:${txId}:${currentCat.id}${backSuffix}`,
    }]);
  }

  // ── Rows 1-N: flat list or group tabs ────────────────────────────────────
  if (useFlat) {
    // Exclude current cat (already shown at top as ✨ hint)
    const catsToShow = currentCat
      ? standardCats.filter(c => c.id !== currentCat.id)
      : standardCats;

    for (let i = 0; i < catsToShow.length; i += 2) {
      const a = catsToShow[i]!;
      const b = catsToShow[i + 1];
      const btnA = {
        text: `${getCategoryEmoji(a.name, a.icon)} ${a.name}`,
        callback_data: `tx:c:cat:${txId}:${a.id}${backSuffix}`,
      };
      rows.push(b
        ? [btnA, {
            text: `${getCategoryEmoji(b.name, b.icon)} ${b.name}`,
            callback_data: `tx:c:cat:${txId}:${b.id}${backSuffix}`,
          }]
        : [btnA],
      );
    }
  } else {
    // Group tabs — user drills into 🛒 Жизнь or 💼 Бизнес
    rows.push([
      { text: '🛒 Жизнь',  callback_data: `tx:catg:life:${txId}${backSuffix}` },
      { text: '💼 Бизнес', callback_data: `tx:catg:biz:${txId}${backSuffix}` },
    ]);
  }

  // ── ⭐ Мои (N) — custom categories tab ──────────────────────────────────
  if (customCats.length > 0) {
    rows.push([{
      text: `⭐ Мои (${String(customCats.length)})`,
      callback_data: `tx:catg:mine:${txId}${backSuffix}`,
    }]);
  }

  // ── ✏️ Создать + ◀️ Назад ───────────────────────────────────────────────
  rows.push([{ text: '✏️ Создать', callback_data: `cc:new:tx:${txId}${backSuffix}` }]);
  rows.push([{ text: '◀️ Назад',   callback_data: `tx:v:${txId}${backSuffix}` }]);

  return {
    text: '📁 <b>Категория:</b>',
    keyboard: { inline_keyboard: rows },
  };
}

// ─────────────────────────────────────────────────────────────
// Builder 3: Account Picker
// ─────────────────────────────────────────────────────────────

/**
 * Build the Account picker.
 *
 * Layout:
 *   [🏦 Name · bal CUR]   ← accounts matching txCurrency (listed first)
 *   [⚠️ Name · bal CUR]   ← accounts with a different currency (listed after)
 *   [◀️ Назад]
 *
 * Header text changes when cross-currency accounts are present:
 *   - Same-currency only: '🏦 <b>Выберите счёт:</b>'
 *   - Mixed: '🏦 <b>Выберите счёт:</b>\n\n<i>🏦 — совпадает ... · ⚠️ — другая валюта</i>'
 *
 * @param txId       - Transaction ULID
 * @param accounts   - All accounts for the workspace (from getWorkspaceAccounts)
 * @param txCurrency - Currency of the transaction (e.g. 'USD'); '' = no filtering
 * @param backSuffix - Callback suffix (e.g. ':s')
 */
export function buildQuickEditAccountKb(
  txId: string,
  accounts: QEAccountInfo[],
  txCurrency: string,
  backSuffix: string,
): QEKeyboardResult {
  const txCur = txCurrency.toUpperCase();

  const same  = txCur ? accounts.filter(a => a.currency.toUpperCase() === txCur)  : accounts;
  const cross = txCur ? accounts.filter(a => a.currency.toUpperCase() !== txCur)  : [];

  const makeBtn = (acc: QEAccountInfo, isCross: boolean) => {
    const icon  = isCross ? '⚠️' : '🏦';
    const bal   = fmtBalance(acc.balance);
    const label = `${icon} ${escapeHtml(acc.name)} · ${bal} ${escapeHtml(acc.currency)}`;
    return {
      text: label,
      callback_data: `tx:c:acc:${txId}:${acc.id}${backSuffix}`,
    };
  };

  const rows: { text: string; callback_data: string }[][] = [
    ...same.map(a  => [makeBtn(a, false)]),
    ...cross.map(a => [makeBtn(a, true)]),
    [{ text: '◀️ Назад', callback_data: `tx:v:${txId}${backSuffix}` }],
  ];

  const header = cross.length > 0
    ? `🏦 <b>Выберите счёт:</b>\n\n<i>🏦 — совпадает по валюте (${escapeHtml(txCurrency)}) · ⚠️ — другая валюта</i>`
    : '🏦 <b>Выберите счёт:</b>';

  return { text: header, keyboard: { inline_keyboard: rows } };
}

// ─────────────────────────────────────────────────────────────
// Builder 4: Intent (Type) Picker
// ─────────────────────────────────────────────────────────────

const INTENT_BUTTON_LABELS: Record<string, string> = {
  income:        '💰 Доход',
  expense:       '💸 Расход',
  debt_given:    '🤝 Долг (дал)',
  debt_received: '🤲 Долг (взял)',
  transfer:      '🔄 Перевод',
};

/**
 * Build the Intent (transaction type) picker.
 *
 * Layout: one button per intent, then ◀️ Назад.
 * Mirrors the `int` branch in handleQuickEditField.
 *
 * @param txId       - Transaction ULID
 * @param backSuffix - Callback suffix (e.g. ':s')
 */
export function buildQuickEditIntentKb(
  txId: string,
  backSuffix: string,
): QEKeyboardResult {
  const rows: { text: string; callback_data: string }[][] = QE_EDITABLE_INTENTS.map(intent => [
    {
      text: INTENT_BUTTON_LABELS[intent] ?? intent,
      callback_data: `tx:c:int:${txId}:${intent}${backSuffix}`,
    },
  ]);
  rows.push([{ text: '◀️ Назад', callback_data: `tx:v:${txId}${backSuffix}` }]);

  return {
    text: '🔄 Выберите тип:',
    keyboard: { inline_keyboard: rows },
  };
}
