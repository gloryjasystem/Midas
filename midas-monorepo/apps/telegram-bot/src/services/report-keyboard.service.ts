/**
 * Report Keyboard Service — Phase 2.0 Sprint 4
 *
 * Builds all InlineKeyboardMarkup objects for the Reports 2.0 screen.
 * Includes:
 *   - Period picker (8 preset periods)
 *   - Report sub-menu (6 report types)
 *   - Callback parser (rp: namespace)
 *
 * Callback_data format (namespace: "rp"):
 *   rp:p          → period picker menu                [4 bytes]
 *   rp:p:td       → today                             [7 bytes]
 *   rp:p:yd       → yesterday                         [7 bytes]
 *   rp:p:tw       → this week                         [7 bytes]
 *   rp:p:lw       → last week                         [7 bytes]
 *   rp:p:tm       → this month                        [7 bytes]
 *   rp:p:lm       → last month                        [7 bytes]
 *   rp:p:3m       → 3 months                          [7 bytes]
 *   rp:p:yr       → year                              [7 bytes]
 *   rp:sum        → summary report                    [6 bytes]
 *   rp:cat        → category breakdown                [6 bytes]
 *   rp:exp        → expenses only                     [6 bytes]
 *   rp:inc        → income only                       [6 bytes]
 *   rp:cmp        → comparison with previous period   [6 bytes]
 *   rp:acc        → account movements                 [6 bytes]
 *   rp:bk         → back to period picker             [5 bytes]
 *
 * All callback_data values ≤ 64 bytes (Telegram limit). ✅
 */

import type { InlineKeyboardMarkup } from './telegram-api.js';

// ─────────────────────────────────────────────────────────────
// Period codes
// ─────────────────────────────────────────────────────────────

const VALID_PERIOD_CODES = ['td', 'yd', 'tw', 'lw', 'tm', 'lm', '3m', 'yr'] as const;
export type PeriodCode = typeof VALID_PERIOD_CODES[number];

// ─────────────────────────────────────────────────────────────
// Keyboards
// ─────────────────────────────────────────────────────────────

/**
 * Build the period picker keyboard.
 *
 * Layout:
 *   [Сегодня]     [Вчера]
 *   [Эта неделя]  [Прошлая]
 *   [Этот месяц]  [Прошлый]
 *   [3 месяца]    [Год]
 */
export function buildPeriodPickerKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📅 Сегодня',     callback_data: 'rp:p:td' },
        { text: '📅 Вчера',       callback_data: 'rp:p:yd' },
      ],
      [
        { text: '📆 Эта неделя',  callback_data: 'rp:p:tw' },
        { text: '📆 Прошлая',     callback_data: 'rp:p:lw' },
      ],
      [
        { text: '🗓 Этот месяц',  callback_data: 'rp:p:tm' },
        { text: '🗓 Прошлый',     callback_data: 'rp:p:lm' },
      ],
      [
        { text: '📊 3 месяца',    callback_data: 'rp:p:3m' },
        { text: '📊 Год',         callback_data: 'rp:p:yr' },
      ],
    ],
  };
}

/**
 * Build the report sub-menu keyboard.
 * Shown after the user selects a period.
 *
 * Layout:
 *   [📋 Сводка]     [📊 Категории]
 *   [💸 Расходы]    [💰 Доходы]
 *   [📈 Сравнение]  [🏦 По счетам]
 *   [◀️ Выбрать период]
 */
export function buildReportSubMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📋 Сводка',      callback_data: 'rp:sum' },
        { text: '📊 Категории',   callback_data: 'rp:cat' },
      ],
      [
        { text: '💸 Расходы',     callback_data: 'rp:exp' },
        { text: '💰 Доходы',      callback_data: 'rp:inc' },
      ],
      [
        { text: '📈 Сравнение',   callback_data: 'rp:cmp' },
        { text: '🏦 По счетам',   callback_data: 'rp:acc' },
      ],
      [
        { text: '◀️ Выбрать период', callback_data: 'rp:bk' },
      ],
    ],
  };
}

/**
 * Build a "back to sub-menu" keyboard for individual reports.
 */
export function buildReportBackKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '◀️ К отчётам',   callback_data: 'rp:p'  },
        { text: '📅 Другой период', callback_data: 'rp:bk' },
      ],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────

/**
 * Parsed report callback command.
 */
export type RpCallbackCmd =
  | { cmd: 'period_picker' }
  | { cmd: 'set_period'; code: PeriodCode }
  | { cmd: 'summary' }
  | { cmd: 'categories' }
  | { cmd: 'expenses' }
  | { cmd: 'income' }
  | { cmd: 'comparison' }
  | { cmd: 'accounts' }
  | { cmd: 'back' };

/**
 * Parse a rp: callback_data string into a typed command.
 * Returns null for invalid/unrecognized data.
 */
export function parseRpCallback(data: string): RpCallbackCmd | null {
  if (!data.startsWith('rp:')) return null;

  const parts = data.split(':');
  const sub = parts[1] ?? '';

  // rp:p → period picker (or rp:p:{code} → set period)
  if (sub === 'p') {
    if (parts.length === 2) return { cmd: 'period_picker' };
    const code = parts[2] ?? '';
    if ((VALID_PERIOD_CODES as readonly string[]).includes(code)) {
      return { cmd: 'set_period', code: code as PeriodCode };
    }
    return null;
  }

  // rp:sum → summary
  if (sub === 'sum') return { cmd: 'summary' };
  // rp:cat → categories
  if (sub === 'cat') return { cmd: 'categories' };
  // rp:exp → expenses
  if (sub === 'exp') return { cmd: 'expenses' };
  // rp:inc → income
  if (sub === 'inc') return { cmd: 'income' };
  // rp:cmp → comparison
  if (sub === 'cmp') return { cmd: 'comparison' };
  // rp:acc → accounts
  if (sub === 'acc') return { cmd: 'accounts' };
  // rp:bk → back to period picker
  if (sub === 'bk')  return { cmd: 'back' };

  return null;
}

// ─────────────────────────────────────────────────────────────
// Period helpers
// ─────────────────────────────────────────────────────────────

/**
 * Convert a period code to [start, end] ISO date range.
 * All times are in UTC. The end is exclusive (start of next day/period).
 */
export function periodCodeToRange(code: PeriodCode): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  let start: Date;
  let end: Date;

  switch (code) {
    case 'td': // today
      start = new Date(year, month, day);
      end   = new Date(year, month, day + 1);
      break;
    case 'yd': // yesterday
      start = new Date(year, month, day - 1);
      end   = new Date(year, month, day);
      break;
    case 'tw': { // this week (Monday start)
      const dow = now.getDay() || 7; // Sun=7
      start = new Date(year, month, day - dow + 1);
      end   = new Date(year, month, day + 1);
      break;
    }
    case 'lw': { // last week
      const dow2 = now.getDay() || 7;
      const thisMonday = new Date(year, month, day - dow2 + 1);
      start = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
      end   = thisMonday;
      break;
    }
    case 'tm': // this month
      start = new Date(year, month, 1);
      end   = new Date(year, month, day + 1);
      break;
    case 'lm': // last month
      start = new Date(year, month - 1, 1);
      end   = new Date(year, month, 1);
      break;
    case '3m': // 3 months
      start = new Date(year, month - 3, day);
      end   = new Date(year, month, day + 1);
      break;
    case 'yr': // this year
      start = new Date(year, 0, 1);
      end   = new Date(year, month, day + 1);
      break;
  }

  return {
    start: start.toISOString(),
    end:   end.toISOString(),
  };
}

/**
 * Human-readable period label for report headers.
 */
const MONTH_NAMES_RU_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const MONTH_NAMES_RU_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export function periodLabel(code: PeriodCode): string {
  const now = new Date();
  switch (code) {
    case 'td': return `${now.getDate()} ${MONTH_NAMES_RU_GEN[now.getMonth()]}`;
    case 'yd': {
      const yd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return `${yd.getDate()} ${MONTH_NAMES_RU_GEN[yd.getMonth()]}`;
    }
    case 'tw': return 'Эта неделя';
    case 'lw': return 'Прошлая неделя';
    case 'tm': return `${MONTH_NAMES_RU_NOM[now.getMonth()]} ${now.getFullYear()}`;
    case 'lm': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${MONTH_NAMES_RU_NOM[lm.getMonth()]} ${lm.getFullYear()}`;
    }
    case '3m': return 'Последние 3 месяца';
    case 'yr': return `${now.getFullYear()} год`;
  }
}
