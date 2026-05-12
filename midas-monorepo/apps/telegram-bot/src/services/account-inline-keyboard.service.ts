/**
 * Account Inline Keyboard Service — Phase 1.31 / Phase 2.4
 *
 * Builds Telegram InlineKeyboardMarkup for inline account creation/selection
 * during the transaction confirmation flow.
 *
 * Callback_data namespace: "ia:"
 *
 *   Phase 1.31 (account creation sub-flow):
 *   ia:create:{draftId}            → create account with AI-suggested name/currency
 *   ia:skip:{draftId}              → proceed without account — use workspace default
 *   ia:use:{accountId}:{draftId}   → use existing account (Scenario Г picker)
 *   ia:fuzzy:{accountId}:{draftId} → confirm fuzzy-matched account
 *   ia:rename:{draftId}            → enter custom name via text
 *
 *   Phase 2.4 (account-aware draft card picker):
 *   ia:acc:pick:{accountId}:{draftId} → user selected account from V2 picker
 *
 * Byte budget (all ≤ 64 bytes):
 *   "ia:create:"       = 10 + 26 (ULID)        = 36 bytes
 *   "ia:skip:"         = 8  + 26               = 34 bytes
 *   "ia:use:"          = 7  + 26 + 1 + 26      = 60 bytes
 *   "ia:fuzzy:"        = 9  + 26 + 1 + 26      = 62 bytes
 *   "ia:rename:"       = 10 + 26               = 36 bytes
 *   "ia:acc:pick:"     = 12 + 26 + 1 + 26      = 65 bytes  ← WARN: 65! Use ia:pk: instead
 *
 * BYTE BUDGET AUDIT (Phase 2.4):
 *   "ia:pk:" = 6 + 26 + 1 + 26 = 59 bytes ≤ 64 ✓
 *   (ia:acc:pick exceeds 64 bytes; shortened to ia:pk for safety)
 *
 * All values ≤ 64 bytes. No user-provided data enters callback_data.
 *
 * Redis state key: midas:ia:{draftId}  TTL 300s
 * Used ONLY for the ia:rename sub-flow (user types custom account name).
 * Value: JSON.stringify(InlineAccountState)
 *
 * SEC-01: draftId and accountId are system ULIDs — user-controlled values
 *         are never embedded in callback_data.
 * SEC-12: Account names and currencies NOT logged.
 */

import type { InlineKeyboardMarkup } from '../services/telegram-api.js';

// ─────────────────────────────────────────────────────────────
// Redis state type for rename sub-flow
// ─────────────────────────────────────────────────────────────

export interface InlineAccountState {
  /** Step within rename sub-flow */
  step: 'name_input';
  /** Suggested account name from AI (may be empty if none) */
  suggestedName: string;
  /** Currency detected from the draft's parsed_currency */
  currency: string;
  /** The draft to finalise after account creation */
  draftId: string;
}

// ─────────────────────────────────────────────────────────────
// Callback parser — SEC-01 allowlist
// ─────────────────────────────────────────────────────────────

const ULID_RE = /^[0-9A-Z]{26}$/;

export type InlineAccountCmd =
  | { cmd: 'create'; draftId: string }
  | { cmd: 'skip';   draftId: string }
  | { cmd: 'use';    accountId: string; draftId: string }
  | { cmd: 'fuzzy';  accountId: string; draftId: string }
  | { cmd: 'rename'; draftId: string }
  /** Phase 2.4: user selected account from V2 picker (ia:pk:{accountId}:{draftId}) */
  | { cmd: 'pick';   accountId: string; draftId: string }
  /** Phase 2.4: user tapped "🔄 Сменить счёт" — delinks current account (ia:pk:delink:{draftId}) */
  | { cmd: 'delink'; draftId: string };

/**
 * Parse and validate an inline account creation callback_data string.
 * Returns null for any unrecognised or malformed input (SEC-01 allowlist).
 *
 * Valid formats:
 *   ia:create:{ULID}
 *   ia:skip:{ULID}
 *   ia:use:{ULID}:{ULID}
 *   ia:fuzzy:{ULID}:{ULID}
 *   ia:rename:{ULID}
 */
export function parseInlineAccountCallback(data: string): InlineAccountCmd | null {
  if (!data.startsWith('ia:')) return null;

  const parts = data.split(':');
  const sub = parts[1] ?? '';

  if (sub === 'create' && parts.length === 3) {
    const draftId = parts[2] ?? '';
    if (!ULID_RE.test(draftId)) return null;
    return { cmd: 'create', draftId };
  }

  if (sub === 'skip' && parts.length === 3) {
    const draftId = parts[2] ?? '';
    if (!ULID_RE.test(draftId)) return null;
    return { cmd: 'skip', draftId };
  }

  if (sub === 'rename' && parts.length === 3) {
    const draftId = parts[2] ?? '';
    if (!ULID_RE.test(draftId)) return null;
    return { cmd: 'rename', draftId };
  }

  if (sub === 'use' && parts.length === 4) {
    const accountId = parts[2] ?? '';
    const draftId   = parts[3] ?? '';
    if (!ULID_RE.test(accountId) || !ULID_RE.test(draftId)) return null;
    return { cmd: 'use', accountId, draftId };
  }

  if (sub === 'fuzzy' && parts.length === 4) {
    const accountId = parts[2] ?? '';
    const draftId   = parts[3] ?? '';
    if (!ULID_RE.test(accountId) || !ULID_RE.test(draftId)) return null;
    return { cmd: 'fuzzy', accountId, draftId };
  }

  // Phase 2.4: ia:pk:{accountId}:{draftId}
  // «ia:pk:delink:{draftId}» — delink current account (change button)
  // «ia:pk:{accountId}:{draftId}» — pick specific account
  // \"ia:pk:\" = 6 + 26 + 1 + 26 = 59 bytes ≤ 64 ✓
  if (sub === 'pk' && parts.length === 4) {
    const seg2 = parts[2] ?? '';
    const seg3 = parts[3] ?? '';

    // delink: ia:pk:delink:{draftId}
    if (seg2 === 'delink') {
      if (!ULID_RE.test(seg3)) return null;
      return { cmd: 'delink', draftId: seg3 };
    }

    // pick: ia:pk:{accountId}:{draftId}
    if (!ULID_RE.test(seg2) || !ULID_RE.test(seg3)) return null;
    return { cmd: 'pick', accountId: seg2, draftId: seg3 };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Keyboard builders
// ─────────────────────────────────────────────────────────────

/**
 * Keyboard shown when AI hint matches NO account (Scenario А).
 * Offers: create with suggested name | enter custom name | proceed without account.
 */
export function buildNoMatchKeyboard(
  draftId: string,
  suggestedName: string,
  currency: string,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: `✅ Создать «${suggestedName}» (${currency})`, callback_data: `ia:create:${draftId}` }],
      [{ text: '✏️ Другое название',                          callback_data: `ia:rename:${draftId}` }],
      [{ text: '📋 Записать без счёта',                       callback_data: `ia:skip:${draftId}` }],
    ],
  };
}

/**
 * Keyboard shown when AI hint fuzzy-matches an existing account (Scenario Ж).
 * Offers: confirm matched account | enter different account.
 */
export function buildFuzzyMatchKeyboard(
  draftId: string,
  accountId: string,
  matchedName: string,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: `✅ Да, «${matchedName}»`, callback_data: `ia:fuzzy:${accountId}:${draftId}` }],
      [{ text: '🏦 Другой счёт',          callback_data: `ia:skip:${draftId}` }],
    ],
  };
}

/**
 * Keyboard shown when workspace has multiple accounts matching the currency
 * and no clear account name was mentioned — present a picker (Scenario Г).
 * Max 6 accounts shown to keep keyboard manageable.
 */
export function buildAccountPickerKeyboard(
  draftId: string,
  accounts: Array<{ id: string; name: string; currency: string }>,
): InlineKeyboardMarkup {
  const rows = accounts.slice(0, 6).map((acc) => [
    {
      text: `🏦 ${acc.name} (${acc.currency})`,
      callback_data: `ia:use:${acc.id}:${draftId}`,
    },
  ]);
  rows.push([{ text: '📋 Без счёта', callback_data: `ia:skip:${draftId}` }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Message text helpers
// ─────────────────────────────────────────────────────────────

/**
 * Text for no-match scenario (Scenario А — unknown account).
 * SEC-12: suggestedName and currency are from AI/draft (not logged here).
 */
export function noMatchText(suggestedName: string, currency: string): string {
  return (
    `📝 Транзакция распознана.\n` +
    `Счёта <b>${suggestedName}</b> нет в вашем списке.\n\n` +
    `Создать счёт <b>${suggestedName}</b> (${currency})?`
  );
}

/**
 * Text for fuzzy-match scenario (Scenario Ж — close name match).
 */
export function fuzzyMatchText(hintName: string, matchedName: string): string {
  return (
    `📝 Транзакция распознана.\n` +
    `Счёт «${hintName}» не найден точно.\n` +
    `Возможно, имеется в виду <b>${matchedName}</b>?`
  );
}

/**
 * Text for multiple-account picker (Scenario Г).
 */
export const ACCOUNT_PICKER_TEXT = '📝 Транзакция распознана.\nС какого счёта?';

/**
 * Prompt for custom account name input (rename sub-flow).
 */
export const RENAME_PROMPT = '✏️ Как назовём счёт?';

// ─────────────────────────────────────────────────────────────
// Phase 2.4 — Account Picker V2 (Account-Aware Draft Card)
// ─────────────────────────────────────────────────────────────

/** Minimal account shape required by buildAccountPickerV2Keyboard. */
export interface AccountPickerEntry {
  id: string;
  name: string;     // pre-escaped by caller
  currency: string;
  balance: string;  // NUMERIC string from DB (::TEXT), e.g. "15400.0000"
}

/**
 * Account picker text shown above the keyboard.
 * Displayed when the user has not yet selected an account for this draft.
 */
export const ACCOUNT_PICKER_V2_TEXT =
  '🏦 <b>С какого счёта списать?</b>';

/**
 * Text shown when an account has already been selected and we render
 * the debit confirmation block (account name + balance math).
 */
export const ACCOUNT_DEBIT_CONFIRM_TEXT =
  '<i>Выберите другой счёт или подтвердите транзакцию.</i>';

/**
 * Build the Phase 2.4 account picker keyboard.
 *
 * Shows up to 8 accounts, each as a single button:
 *   [🏦 Bybit · 15 400 USDT]
 *
 * Callback: ia:pk:{accountId}:{draftId}  (59 bytes ≤ 64 ✓)
 *
 * Layout rules:
 *   - One account per row (full width → maximum tap surface on mobile).
 *   - Max 8 accounts — keeps keyboard under ~10 rows.
 *   - Balance stripped of trailing zeros via formatAmount (imported internally).
 *   - Last row: [📝 Без счёта] — links to ia:skip for backward compat.
 *
 * @param accounts - Array of AccountPickerEntry (max 8 used, rest ignored)
 * @param draftId  - ULID of the current draft
 *
 * SEC-01: Only system ULIDs in callback_data — account names never embedded.
 */
export function buildAccountPickerV2Keyboard(
  accounts: AccountPickerEntry[],
  draftId: string,
): InlineKeyboardMarkup {
  const rows = accounts.slice(0, 8).map((acc) => {
    // Strip trailing zeros from balance for display: 15400.0000 → 15400
    const balDisplay = stripTrailingZeros(acc.balance);
    return [{
      text: `🏦 ${acc.name} · ${balDisplay} ${acc.currency}`,
      callback_data: `ia:pk:${acc.id}:${draftId}`,
    }];
  });

  // "Записать без счёта" — always last
  rows.push([{ text: '📝 Без счёта', callback_data: `ia:skip:${draftId}` }]);

  return { inline_keyboard: rows };
}

/**
 * Build the keyboard shown when an account HAS been selected on the draft card.
 * Replaces the picker with a single "change" button.
 *
 * Layout:
 *   Row 1: [🔄 Сменить счёт]   ← delinks current account, re-renders picker
 *
 * The delink triggers patchDraftAccount(null) (PR 4) and then re-shows
 * buildAccountPickerV2Keyboard.
 *
 * @param draftId - ULID of the current draft
 *
 * SEC-01: only system ULID in callback_data.
 */
export function buildAccountSelectedKeyboard(
  draftId: string,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🔄 Сменить счёт', callback_data: `ia:pk:delink:${draftId}` }],
    ],
  };
}


// ─ internal helper ───────────────────────────────────────────────────
/** Strip trailing decimal zeros: "15400.0000" → "15400", "100.50" → "100.5" */
function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

// ─────────────────────────────────────────────────────────────
// Phase 2.4 PR 11 — Full Account Picker for Draft Card
// ─────────────────────────────────────────────────────────────

/** Minimal rich account shape used by buildAccountPickerForDraft. */
export interface AccountPickerFullEntry {
  id: string;
  name: string;     // pre-escaped HTML by caller
  currency: string;
  type: string;     // DB enum: 'manual' | 'crypto_read_only' | 'bank_sync'
  balance: string;  // NUMERIC string, e.g. "15400.0000"
}

/**
 * Resolve an emoji for the account type:
 *   bank_sync       → 🏦
 *   crypto_read_only → 💎
 *   manual + crypto currency (BTC/ETH/USDT/SOL/TON…) → 💎
 *   manual + USD/EUR/RUB/… → 💵 (cash feel) if name contains cash hint, else 💳
 */
function accountTypeEmoji(type: string, currency: string, name: string): string {
  if (type === 'bank_sync') return '🏦';
  if (type === 'crypto_read_only') return '💎';
  // manual — heuristic by currency
  const CRYPTO_CURRENCIES = new Set(['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'TON', 'BNB', 'XRP', 'ADA', 'DOT']);
  if (CRYPTO_CURRENCIES.has(currency.toUpperCase())) return '💎';
  // cash heuristic (Russian word «Наличные», «Кошелёк», «Cash»)
  const nameLower = name.toLowerCase();
  if (nameLower.includes('налич') || nameLower.includes('cash') || nameLower.includes('кошел')) return '💵';
  return '🏦';
}

/**
 * Phase 2.4 PR 11 — Full account picker shown on the separate picker screen.
 *
 * Design (from account_debit_ux_plan.md):
 *   [ ✓ 🏦 Bybit USD · 15 400 ]   ← current account
 *   [    🏦 Bybit USDT · 2 100 ]
 *   [    💳 Тинькофф · 80 000 RUB ]
 *   [    💵 Наличные USD · 500 ]
 *   [    💎 Kraken ETH · 2.45 ]
 *   [         ◀️ Назад         ]   ← bottom row
 *
 * When accounts array is empty:
 *   [         ◀️ Назад         ]
 * (text will inform the user via message, not keyboard)
 *
 * Callback formats:
 *   ia:pk:{accountId}:{draftId}  — select account  (59 bytes ≤ 64 ✓)
 *   ia:pk:delink:{draftId}       — back / cancel    (37 bytes ≤ 64 ✓)
 *
 * @param draftId          - ULID of the draft being configured
 * @param accounts         - Sorted list (default first). Max 8 shown.
 * @param currentAccountId - Currently selected account id, or null
 *
 * SEC-01: account names / user data are NOT embedded in callback_data.
 */
export function buildAccountPickerForDraft(
  draftId: string,
  accounts: AccountPickerFullEntry[],
  currentAccountId: string | null,
): InlineKeyboardMarkup {
  const rows = accounts.slice(0, 8).map((acc) => {
    const emoji  = accountTypeEmoji(acc.type, acc.currency, acc.name);
    const bal    = stripTrailingZeros(acc.balance);
    const check  = acc.id === currentAccountId ? '✓ ' : '   ';
    return [{
      text: `${check}${emoji} ${acc.name} · ${bal} ${acc.currency}`,
      callback_data: `ia:pk:${acc.id}:${draftId}`,
    }];
  });

  // Always-last: back button (delinks current account, redisplays picker or card)
  rows.push([{ text: '◀️ Назад', callback_data: `ia:pk:delink:${draftId}` }]);

  return { inline_keyboard: rows };
}

/**
 * Text shown above the full picker screen.
 * Used when user taps "🔄 Сменить счёт" or "➕ Выбрать счёт" on the draft card.
 */
export const ACCOUNT_PICKER_SCREEN_TEXT =
  '🔄 <b>Выберите счёт</b>\n\nС какого счёта будет списана транзакция?';

/**
 * Text shown above the full picker screen when the workspace has no accounts.
 */
export const ACCOUNT_PICKER_EMPTY_TEXT =
  '🔄 <b>Выберите счёт</b>\n\nУ вас пока нет счетов.\nСоздайте счёт в разделе 💰 Баланс.';


