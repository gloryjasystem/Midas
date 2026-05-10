/**
 * Settings Service — Phase 1.25 / Phase 1.35
 *
 * Implements workspace settings management:
 *   - View: /settings → shows current default_currency, timezone, default accounts
 *   - Update currency: /settings currency <CODE>
 *   - Update timezone: via search-based callback flow (Phase 1.35)
 *   - Default accounts: via callback-based picker (Phase 1.35)
 *
 * SEC-02: No financial amounts.
 * SEC-03: All queries inside withTenantTransaction with explicit workspace_id filter.
 * SEC-12: Settings values are NOT user PII but excluded from logs for consistency.
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';
import type { InlineKeyboardMarkup, InlineKeyboardButton } from './telegram-api.js';

// ─────────────────────────────────────────────────────────────
// IANA Timezone validation set (Node.js 18+ built-in)
// ─────────────────────────────────────────────────────────────

const VALID_TIMEZONES: ReadonlySet<string> = new Set(
  Intl.supportedValuesOf('timeZone'),
);

// ─────────────────────────────────────────────────────────────
// Currency validation
// ─────────────────────────────────────────────────────────────

const CURRENCY_REGEX = /^[A-Z]{3,5}$/;

function isValidCurrency(code: string): boolean {
  return CURRENCY_REGEX.test(code);
}

function isValidTimezone(zone: string): boolean {
  return VALID_TIMEZONES.has(zone);
}

// ─────────────────────────────────────────────────────────────
// Parsed command types
// ─────────────────────────────────────────────────────────────

export type SettingsCommand =
  | { action: 'view' }
  | { action: 'currency'; code: string }
  | { action: 'timezone'; zone: string }
  | { error: string };

// ─────────────────────────────────────────────────────────────
// parseSettingsArgs
// ─────────────────────────────────────────────────────────────

export function parseSettingsArgs(text: string): SettingsCommand {
  const parts = text.trim().split(/\s+/);

  if (parts.length === 1) {
    return { action: 'view' };
  }

  const sub = parts[1]?.toLowerCase() ?? '';

  if (sub === 'currency') {
    const code = parts[2] ?? '';
    if (code.length === 0) {
      return {
        error:
          'Не указан код валюты.\n' +
          'Использование: /settings currency <КОД>\n' +
          'Пример: /settings currency USDT',
      };
    }
    if (!isValidCurrency(code)) {
      return {
        error:
          `Неверный формат валюты: «${code}».\n` +
          'Используй 3–5 букв латиницей в верхнем регистре.\n' +
          'Пример: /settings currency USDT',
      };
    }
    return { action: 'currency', code };
  }

  if (sub === 'timezone') {
    const zone = parts[2] ?? '';
    if (zone.length === 0) {
      return {
        error:
          'Не указан часовой пояс.\n' +
          'Использование: /settings timezone <Часовой_пояс>\n' +
          'Пример: /settings timezone Europe/Moscow',
      };
    }
    if (!isValidTimezone(zone)) {
      return {
        error:
          `Неизвестный часовой пояс: «${zone}».\n` +
          'Используй IANA-формат.\n' +
          'Примеры: Europe/Moscow, Asia/Tokyo, America/New_York, UTC',
      };
    }
    return { action: 'timezone', zone };
  }

  return {
    error:
      `Неизвестная подкоманда: «${parts[1] ?? ''}».\n` +
      'Доступные:\n' +
      '  /settings — показать настройки\n' +
      '  /settings currency <КОД> — сменить базовую валюту\n' +
      '  /settings timezone <Зона> — сменить часовой пояс',
  };
}

// ─────────────────────────────────────────────────────────────
// DB row types
// ─────────────────────────────────────────────────────────────

interface WorkspaceSettings {
  default_currency: string;
  timezone: string;
  default_expense_account_id: string | null;
  default_income_account_id: string | null;
  main_account_name: string | null;
}

export interface AccountRow {
  id: string;
  name: string;
}

// ─────────────────────────────────────────────────────────────
// getSettings — Phase 1.35 expanded
// ─────────────────────────────────────────────────────────────

export async function getSettings(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceSettings | null> {
  return withTenantTransaction<WorkspaceSettings | null>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<WorkspaceSettings>(
        `SELECT
           w.default_currency,
           w.timezone,
           w.default_expense_account_id,
           w.default_income_account_id,
           ea.name AS main_account_name
         FROM workspaces w
         LEFT JOIN account_sources ea ON ea.id = w.default_expense_account_id
         WHERE w.id = $1`,
        [workspaceId],
      );
      return result.rows[0] ?? null;
    },
  );
}

// ─────────────────────────────────────────────────────────────
// getWorkspaceAccounts
// ─────────────────────────────────────────────────────────────

export async function getWorkspaceAccounts(
  workspaceId: string,
  userId: string,
): Promise<AccountRow[]> {
  return withTenantTransaction<AccountRow[]>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<AccountRow>(
        `SELECT id, name FROM account_sources
         WHERE workspace_id = $1 AND deleted_at IS NULL
         ORDER BY name`,
        [workspaceId],
      );
      return result.rows;
    },
  );
}

// ─────────────────────────────────────────────────────────────
// setDefaultAccount — Phase 1.35
// ─────────────────────────────────────────────────────────────

export async function setDefaultAccount(
  workspaceId: string,
  userId: string,
  accountId: string | null,
): Promise<'updated' | 'not_found'> {
  const rowsAffected = await withTenantTransaction<number>(
    workspaceId,
    userId,
    async (client) => {
      if (accountId) {
        const check = await client.query(
          `SELECT id FROM account_sources WHERE id = $1 AND workspace_id = $2`,
          [accountId, workspaceId],
        );
        if (check.rows.length === 0) return 0;
      }
      const result = await client.query(
        `UPDATE workspaces SET default_expense_account_id = $1, default_income_account_id = $1 WHERE id = $2`,
        [accountId, workspaceId],
      );
      return result.rowCount ?? 0;
    },
  );
  return rowsAffected === 0 ? 'not_found' : 'updated';
}

// ─────────────────────────────────────────────────────────────
// updateCurrency
// ─────────────────────────────────────────────────────────────

export async function updateCurrency(
  workspaceId: string,
  userId: string,
  code: string,
): Promise<'updated' | 'not_found'> {
  const rowsAffected = await withTenantTransaction<number>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query(
        `UPDATE workspaces SET default_currency = $1 WHERE id = $2`,
        [code, workspaceId],
      );
      return result.rowCount ?? 0;
    },
  );
  return rowsAffected === 0 ? 'not_found' : 'updated';
}

// ─────────────────────────────────────────────────────────────
// updateTimezone
// ─────────────────────────────────────────────────────────────

export async function updateTimezone(
  workspaceId: string,
  userId: string,
  zone: string,
): Promise<'updated' | 'not_found'> {
  const rowsAffected = await withTenantTransaction<number>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query(
        `UPDATE workspaces SET timezone = $1 WHERE id = $2`,
        [zone, workspaceId],
      );
      return result.rowCount ?? 0;
    },
  );
  return rowsAffected === 0 ? 'not_found' : 'updated';
}

// ─────────────────────────────────────────────────────────────
// Timezone Search — Phase 1.35
// ─────────────────────────────────────────────────────────────

export function searchTimezones(query: string): string[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];

  const matches: string[] = [];
  for (const tz of VALID_TIMEZONES) {
    if (tz.toLowerCase().includes(q)) {
      matches.push(tz);
      if (matches.length >= 8) break;
    }
  }
  return matches;
}

// ─────────────────────────────────────────────────────────────
// Formatting functions
// ─────────────────────────────────────────────────────────────

export function formatSettingsView(settings: WorkspaceSettings): string {
  const currency = escapeHtml(settings.default_currency);
  const timezone = escapeHtml(settings.timezone);
  const mainAcct = settings.main_account_name
    ? escapeHtml(settings.main_account_name)
    : '<i>не задан</i>';

  return (
    '⚙️ <b>Настройки Midas</b>\n\n' +
    `💵 Основная валюта: <b>${currency}</b>\n` +
    `🏦 Основной счет: ${mainAcct}\n` +
    `🕒 Часовой пояс: <b>${timezone}</b>`
  );
}

export function formatCurrencyUpdated(newCode: string, oldCode: string): string {
  return (
    `✅ Базовая валюта обновлена: <b>${escapeHtml(newCode)}</b>\n` +
    `   (было: ${escapeHtml(oldCode)})\n\n` +
    'Новые транзакции без явной валюты будут записаны в ' +
    `<b>${escapeHtml(newCode)}</b>.\n` +
    'Прошлые транзакции не изменены.'
  );
}

export function formatTimezoneUpdated(newZone: string, oldZone: string): string {
  return (
    `✅ Часовой пояс обновлён: <b>${escapeHtml(newZone)}</b>\n` +
    `   (было: ${escapeHtml(oldZone)})`
  );
}

// ─────────────────────────────────────────────────────────────
// Settings Keyboards — Phase 1.35
// ─────────────────────────────────────────────────────────────


export function buildAccountPickerKeyboard(
  accounts: AccountRow[],
  currentDefaultId: string | null,
): InlineKeyboardMarkup {
  const prefix = 'st:da:sa:';
  const rows: InlineKeyboardButton[][] = [];

  for (const acct of accounts) {
    const mark = acct.id === currentDefaultId ? ' ✓' : '';
    rows.push([{
      text: `${acct.name}${mark}`,
      callback_data: `${prefix}${acct.id}`,
    }]);
  }

  rows.push([
    { text: '➕ Создать новый счёт', callback_data: `st:da:new` },
  ]);
  if (currentDefaultId) {
    rows.push([
      { text: '🚫 Убрать основной', callback_data: 'st:da:ca' },
    ]);
  }
  rows.push([
    { text: '← Назад', callback_data: 'st:back' },
  ]);

  return { inline_keyboard: rows };
}

export function buildTimezoneSearchResultKeyboard(zones: string[]): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = zones.map(tz => [
    { text: tz, callback_data: `st:tz:p:${tz}` },
  ]);
  rows.push([{ text: '← Назад', callback_data: 'st:back' }]);
  return { inline_keyboard: rows };
}
