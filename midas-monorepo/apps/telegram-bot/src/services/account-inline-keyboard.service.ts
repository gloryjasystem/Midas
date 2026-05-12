/**
 * Account Inline Keyboard Service — Phase 1.31
 *
 * Builds Telegram InlineKeyboardMarkup for inline account creation/selection
 * during the transaction confirmation flow.
 *
 * Callback_data namespace: "ia:"
 *
 *   ia:create:{draftId}         → create account with AI-suggested name/currency (35 bytes max)
 *   ia:skip:{draftId}           → proceed without account — use workspace default (34 bytes max)
 *   ia:use:{accountId}:{draftId}→ use existing account                           (60 bytes max)
 *   ia:fuzzy:{accountId}:{draftId} → confirm fuzzy-matched account               (63 bytes max)
 *   ia:rename:{draftId}         → enter custom name via text (36 bytes max)
 *
 * Byte budget (all ≤ 64):
 *   "ia:create:" = 10 + 26 (ULID) = 36 bytes
 *   "ia:skip:"   = 8  + 26        = 34 bytes
 *   "ia:use:"    = 7  + 26 + 1 + 26 = 60 bytes  ← MAX for ia:use
 *   "ia:fuzzy:"  = 9  + 26 + 1 + 26 = 62 bytes  ← safe
 *   "ia:rename:" = 10 + 26         = 36 bytes
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
  | { cmd: 'list';   draftId: string }
  | { cmd: 'back';   draftId: string }
  | { cmd: 'use';    accountId: string; draftId: string }
  | { cmd: 'fuzzy';  accountId: string; draftId: string }
  | { cmd: 'rename'; draftId: string };

/**
 * Parse and validate an inline account creation callback_data string.
 * Returns null for any unrecognised or malformed input (SEC-01 allowlist).
 *
 * Valid formats:
 *   ia:create:{ULID}
 *   ia:list:{ULID}
 *   ia:back:{ULID}
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

  if (sub === 'list' && parts.length === 3) {
    const draftId = parts[2] ?? '';
    if (!ULID_RE.test(draftId)) return null;
    return { cmd: 'list', draftId };
  }

  if (sub === 'back' && parts.length === 3) {
    const draftId = parts[2] ?? '';
    if (!ULID_RE.test(draftId)) return null;
    return { cmd: 'back', draftId };
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
      [{ text: '🗂 Выбрать счёт',                             callback_data: `ia:list:${draftId}` }],
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
      [{ text: '🗂 Другой счёт',          callback_data: `ia:list:${draftId}` }],
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
  const rows = accounts.slice(0, 90).map((acc) => [
    {
      text: `🏦 ${acc.name} (${acc.currency})`,
      callback_data: `ia:use:${acc.id}:${draftId}`,
    },
  ]);
  rows.push([{ text: '◀️ Назад', callback_data: `ia:back:${draftId}` }]);
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


