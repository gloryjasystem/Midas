/**
 * Account Onboard Keyboard Service — Phase 1.30
 *
 * Builds Telegram InlineKeyboardMarkup objects for the smart account
 * onboarding flow triggered from /accounts (empty state) and /start
 * (new user guided setup).
 *
 * Callback_data namespace: "ac:"
 *   ac:type:card      → user picked Банковская карта  (12 bytes)
 *   ac:type:cash      → user picked Наличные          (12 bytes)
 *   ac:type:exchange  → user picked Крипто-биржа      (16 bytes) ← MAX
 *   ac:type:wallet    → user picked Крипто-кошелёк    (14 bytes)
 *   ac:type:custom    → user picked Своё название      (14 bytes)
 *   ac:xch:binance    → exchange preset: Binance       (14 bytes)
 *   ac:xch:bybit      → exchange preset: Bybit         (12 bytes)
 *   ac:xch:okx        → exchange preset: OKX           (10 bytes)
 *   ac:xch:kraken     → exchange preset: Kraken        (13 bytes)
 *   ac:xch:huobi      → exchange preset: Huobi         (12 bytes)
 *   ac:xch:custom     → exchange: free-text name       (13 bytes)
 *   ac:cur:USDT       → currency pick: USDT            (11 bytes)
 *   ac:cur:BTC        → currency pick: BTC             (10 bytes)
 *   ac:cur:ETH        → currency pick: ETH             (10 bytes)
 *   ac:cur:custom     → currency: free-text input      (13 bytes)
 *   ac:skip           → skip onboarding (from /start)  (7 bytes)
 *   ac:more           → add another account            (7 bytes)
 *   ac:done           → finish adding accounts         (7 bytes)
 *
 * All values ≤ 16 bytes — safely within Telegram 64-byte limit.
 * No user-provided data enters callback_data.
 *
 * Redis state key: midas:ac:{telegramUserId}:{chatId}  TTL 300s
 * Value: JSON.stringify(AccountOnboardState)
 *
 * SEC-01: All callback type/action values validated against allowlist.
 * SEC-12: No names or amounts logged.
 */

import type { InlineKeyboardMarkup } from '../services/telegram-api.js';

// ─────────────────────────────────────────────────────────────
// Redis state type
// ─────────────────────────────────────────────────────────────

/**
 * Onboarding flow step.
 *   type_pick    → user taps /accounts or /start guided keyboard
 *   name_input   → bot awaiting free-text account name
 *   cur_pick     → bot showing currency keyboard
 *   cur_input    → bot awaiting free-text currency code
 */
export type OnboardStep = 'type_pick' | 'name_input' | 'cur_pick' | 'cur_input';

export interface AccountOnboardState {
  step: OnboardStep;
  /** Account type selected — present from type_pick step onward */
  accountType?: 'card' | 'cash' | 'exchange' | 'wallet' | 'custom';
  /** Account name resolved — present from cur_pick step onward */
  name?: string;
}

// ─────────────────────────────────────────────────────────────
// Exchange preset allowlist (SEC-01)
// ─────────────────────────────────────────────────────────────

export const EXCHANGE_PRESETS: ReadonlyMap<string, string> = new Map([
  ['binance', 'Binance'],
  ['bybit',   'Bybit'],
  ['okx',     'OKX'],
  ['kraken',  'Kraken'],
  ['huobi',   'Huobi'],
]);

// ─────────────────────────────────────────────────────────────
// Currency shortcuts shown in onboarding flow
// ─────────────────────────────────────────────────────────────

/** Presets shown in currency picker during onboarding. */
const ONBOARD_CURRENCY_PRESETS = ['USDT', 'BTC', 'ETH', 'USD', 'EUR', 'RUB'] as const;

// ─────────────────────────────────────────────────────────────
// Callback_data parsed type
// ─────────────────────────────────────────────────────────────

export type AccountOnboardCmd =
  | { cmd: 'type'; accountType: 'card' | 'cash' | 'exchange' | 'wallet' | 'custom' }
  | { cmd: 'exchange_preset'; key: string; name: string }
  | { cmd: 'exchange_custom' }
  | { cmd: 'currency'; code: string }
  | { cmd: 'currency_custom' }
  | { cmd: 'skip' }
  | { cmd: 'more' }
  | { cmd: 'done' }
  | { cmd: 'open' }; // Phase 1.37-UX: open full account type picker from start 2-button keyboard

// ─────────────────────────────────────────────────────────────
// Parser — SEC-01 allowlist
// ─────────────────────────────────────────────────────────────

const ACCOUNT_TYPES = new Set(['card', 'cash', 'exchange', 'wallet', 'custom'] as const);
const CURRENCY_CODE_RE = /^[A-Z]{1,10}$/;

/**
 * Parse and validate an account onboarding callback_data string.
 * Returns null for any unrecognised or malformed input (SEC-01 allowlist).
 *
 * All type values validated against hardcoded allowlist.
 * All exchange preset keys validated against EXCHANGE_PRESETS map.
 * Currency codes validated as /^[A-Z]{1,10}$/ (broader than st: to allow custom tokens).
 */
export function parseAccountCallback(data: string): AccountOnboardCmd | null {
  if (!data.startsWith('ac:')) return null;

  const parts = data.split(':');
  // parts[0] = 'ac'
  const sub = parts[1] ?? '';

  if (sub === 'skip') return { cmd: 'skip' };
  if (sub === 'more') return { cmd: 'more' };
  if (sub === 'done') return { cmd: 'done' };
  if (sub === 'open') return { cmd: 'open' }; // Phase 1.37-UX: open type picker

  if (sub === 'type') {
    const t = parts[2] ?? '';
    if (!ACCOUNT_TYPES.has(t as 'card')) return null;
    return { cmd: 'type', accountType: t as 'card' | 'cash' | 'exchange' | 'wallet' | 'custom' };
  }

  if (sub === 'xch') {
    const key = parts[2] ?? '';
    if (key === 'custom') return { cmd: 'exchange_custom' };
    const name = EXCHANGE_PRESETS.get(key);
    if (!name) return null;
    return { cmd: 'exchange_preset', key, name };
  }

  if (sub === 'cur') {
    const code = parts[2] ?? '';
    if (code === 'custom') return { cmd: 'currency_custom' };
    if (!CURRENCY_CODE_RE.test(code)) return null;
    return { cmd: 'currency', code };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Keyboard builders
// ─────────────────────────────────────────────────────────────

/**
 * Build the guided account type keyboard shown when /accounts is empty.
 * Scenario Д from the roadmap.
 */
export function buildAccountTypeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💳 Банковская карта', callback_data: 'ac:type:card' },
        { text: '💵 Наличные',         callback_data: 'ac:type:cash' },
      ],
      [
        { text: '🔶 Крипто-биржа',  callback_data: 'ac:type:exchange' },
        { text: '₿ Крипто-кошелёк', callback_data: 'ac:type:wallet' },
      ],
      [{ text: '✏️ Своё название', callback_data: 'ac:type:custom' }],
    ],
  };
}

/**
 * Phase 1.37-UX: Minimal 2-button keyboard for /start new user flow.
 * Replaces the 5-button keyboard to eliminate cognitive overload.
 *
 *   [➕ Добавить счёт]    → ac:open  → shows full account type picker (edit in-place)
 *   [▶️ Начать без счёта] → ac:skip  → dismiss, default account is already created
 *
 * ReplyKeyboard is NOT sent here — it activates after account creation or first confirmed tx.
 */
export function buildStartSimpleKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить счёт',     callback_data: 'ac:open' },
        { text: '▶️ Начать без счёта', callback_data: 'ac:skip' },
      ],
    ],
  };
}

/**
 * Build the guided /start account type keyboard for new users.
 * Scenario Е from the roadmap — includes [⏩ Пропустить] button.
 * Used when user taps "Добавить счёт" from the start simple keyboard (ac:open).
 * Also used from /accounts empty-state (Scenario Д).
 */
export function buildStartOnboardKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💳 Банковская карта', callback_data: 'ac:type:card' },
        { text: '💵 Наличные',         callback_data: 'ac:type:cash' },
      ],
      [
        { text: '🔶 Крипто-биржа',  callback_data: 'ac:type:exchange' },
        { text: '₿ Крипто-кошелёк', callback_data: 'ac:type:wallet' },
      ],
      [{ text: '↩️ Назад',  callback_data: 'ac:skip' }],
    ],
  };
}

/**
 * Build the exchange preset picker.
 * Shown after user picks [🔶 Крипто-биржа].
 */
export function buildExchangePickerKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'Binance', callback_data: 'ac:xch:binance' },
        { text: 'Bybit',   callback_data: 'ac:xch:bybit' },
        { text: 'OKX',     callback_data: 'ac:xch:okx' },
      ],
      [
        { text: 'Kraken', callback_data: 'ac:xch:kraken' },
        { text: 'Huobi',  callback_data: 'ac:xch:huobi' },
        { text: '✏️ Другая', callback_data: 'ac:xch:custom' },
      ],
    ],
  };
}

/**
 * Build the currency picker for onboarding.
 * Shows 6 common presets + [✏️ Другая] for free-text input.
 */
export function buildOnboardCurrencyKeyboard(): InlineKeyboardMarkup {
  const rows = [];

  // 3 per row for presets
  for (let i = 0; i < ONBOARD_CURRENCY_PRESETS.length; i += 3) {
    rows.push(
      ONBOARD_CURRENCY_PRESETS.slice(i, i + 3).map((code) => ({
        text: code,
        callback_data: `ac:cur:${code}`,
      })),
    );
  }

  rows.push([{ text: '✏️ Другая валюта', callback_data: 'ac:cur:custom' }]);

  return { inline_keyboard: rows };
}

/**
 * Build the post-creation keyboard: add another or finish.
 */
export function buildAfterCreateKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить ещё счёт', callback_data: 'ac:more' },
        { text: '✅ Готово',             callback_data: 'ac:done' },
      ],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Message text helpers
// ─────────────────────────────────────────────────────────────

/** Text for empty /accounts guided prompt (Scenario Д). */
export const ACCOUNTS_EMPTY_TEXT =
  '🏦 <b>У тебя пока нет счетов.</b>\n\n' +
  'Счёт — это место где хранятся деньги:\n' +
  'карта, кошелёк, биржа, наличные.\n\n' +
  'Создай первый счёт:';

/**
 * Phase 1.37-UX: Welcome text for new user /start — single message, no ReplyKeyboard.
 * Professional, product-grade copy. No examples, no instructions.
 */
export const START_WELCOME_TEXT =
  '👋 <b>Добро пожаловать в Midas!</b>\n\n' +
  'Ваш финансовый ассистент на базе ИИ готов к работе.\n\n' +
  '🏦 Укажите, где хранятся ваши деньги — это позволит вести\n' +
  'точный учёт баланса по каждому счёту.';

/** Text for /start new user guided prompt (Scenario Е). */
export const START_ONBOARD_TEXT =
  '🏦 <b>Где хранишь деньги?</b>\n' +
  'Добавь свои счета (можно несколько):';

/**
 * Phase 1.37-UX: Activation message sent with ReplyKeyboard after account creation.
 * Signals to user that setup is complete and navigation is now available.
 */
export const SETUP_COMPLETE_TEXT =
  '✅ <b>Всё готово!</b>\n\n' +
  'Опишите любую операцию — бот распознает сумму, категорию и тип автоматически.';

/** Text for exchange picker step. */
export const EXCHANGE_PICKER_TEXT = 'Какая биржа?';

/** Text for currency picker step. */
export const CURRENCY_PICKER_TEXT = 'В какой валюте?';

/** Prompt for free-text account name input. */
export function nameInputPrompt(accountType: string): string {
  const labels: Record<string, string> = {
    card:    '💳 Как называется карта или банк?\n(например: <i>Альфа-Банк</i>, <i>Сбербанк</i>)',
    wallet:  '₿ Как называется кошелёк?\n(например: <i>Metamask</i>, <i>Trust Wallet</i>)',
    custom:  '✏️ Введи название счёта:',
  };
  return labels[accountType] ?? '✏️ Введи название счёта:';
}

/** Prompt for free-text currency input. */
export const CURRENCY_INPUT_PROMPT =
  '💱 Введи код валюты (например: <i>SOL</i>, <i>MATIC</i>, <i>UAH</i>):';
