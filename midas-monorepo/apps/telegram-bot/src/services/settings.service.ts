/**
 * Settings Service — Phase 1.25
 *
 * Implements text-based workspace settings management:
 *   - View: /settings → shows current default_currency and timezone
 *   - Update currency: /settings currency <CODE> → updates workspaces.default_currency
 *   - Update timezone: /settings timezone <IANA_ZONE> → updates workspaces.timezone
 *
 * Design decisions:
 *   - Timezone validation: Intl.supportedValuesOf('timeZone') — Node.js 18+ built-in.
 *     No new npm dependencies required. Evaluated once at module load.
 *   - Currency validation: /^[A-Z]{3,5}$/ — matches existing account_sources CHECK constraint.
 *   - All DB ops inside withTenantTransaction: explicit WHERE id = $1 (SEC-03).
 *   - escapeHtml applied to all DB-sourced values in output (Phase 1.15 hardening).
 *
 * SEC-02: No financial amounts.
 * SEC-03: All queries inside withTenantTransaction with explicit workspace_id filter.
 * SEC-12: Currency codes and timezone names are NOT user PII but still excluded from logs
 *         for consistency. Only workspace metadata (workspaceId, action) is logged.
 *
 * Existing data guarantee:
 *   - account_sources rows: NEVER modified by /settings.
 *   - transactions rows: NEVER modified or recalculated.
 *   - Only workspaces.default_currency and workspaces.timezone are updated.
 *
 * Phase 1.26 note:
 *   This is the text-only MVP. Inline keyboard UI is Phase 1.26 scope.
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';

// ─────────────────────────────────────────────────────────────
// IANA Timezone validation set (Node.js 18+ built-in)
// Evaluated once at module load — no runtime cost per request.
// ─────────────────────────────────────────────────────────────

const VALID_TIMEZONES: ReadonlySet<string> = new Set(
  Intl.supportedValuesOf('timeZone'),
);

// ─────────────────────────────────────────────────────────────
// Currency validation
// Matches account_sources CHECK constraint: ^[A-Z]{3,5}$
// ─────────────────────────────────────────────────────────────

const CURRENCY_REGEX = /^[A-Z]{3,5}$/;

/**
 * Validate a currency code string.
 * Returns true if the code is 3–5 uppercase ASCII letters.
 */
function isValidCurrency(code: string): boolean {
  return CURRENCY_REGEX.test(code);
}

/**
 * Validate an IANA timezone string.
 * Uses the built-in Intl.supportedValuesOf('timeZone') set.
 */
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

/**
 * Parse the arguments of the /settings command.
 *
 * Supported forms:
 *   /settings               → { action: 'view' }
 *   /settings currency BTC  → { action: 'currency', code: 'BTC' }
 *   /settings timezone Europe/Moscow → { action: 'timezone', zone: 'Europe/Moscow' }
 *
 * Rejects:
 *   /settings currency      → error (missing code)
 *   /settings currency eth  → error (lowercase not allowed)
 *   /settings blah blah     → error (unknown subcommand)
 *
 * @param text - Full message text from Telegram (e.g. "/settings currency BTC")
 */
export function parseSettingsArgs(text: string): SettingsCommand {
  const parts = text.trim().split(/\s+/);
  // parts[0] = '/settings' (or '/settings@BotName' — already stripped by parseCommandToken)

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
// DB row type
// ─────────────────────────────────────────────────────────────

interface WorkspaceSettings {
  default_currency: string;
  timezone: string;
}

// ─────────────────────────────────────────────────────────────
// getSettings
// ─────────────────────────────────────────────────────────────

/**
 * Fetch the current settings for a workspace.
 *
 * @param workspaceId - Internal workspace ULID (trusted backend — SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @returns WorkspaceSettings or null if workspace not found (should not happen in practice)
 *
 * SEC-03: SELECT runs inside withTenantTransaction with RLS.
 *         Explicit WHERE id = $1 as defense-in-depth.
 */
export async function getSettings(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceSettings | null> {
  return withTenantTransaction<WorkspaceSettings | null>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<WorkspaceSettings>(
        `SELECT default_currency, timezone
         FROM workspaces
         WHERE id = $1`,
        [workspaceId],
      );
      return result.rows[0] ?? null;
    },
  );
}

// ─────────────────────────────────────────────────────────────
// updateCurrency
// ─────────────────────────────────────────────────────────────

/**
 * Update workspaces.default_currency for the given workspace.
 *
 * Does NOT modify:
 *   - account_sources rows (their currencies are independent)
 *   - transactions (base_currency and currency stored per-transaction)
 *
 * @param workspaceId - Internal workspace ULID (trusted backend — SEC-03)
 * @param userId      - Internal user ULID
 * @param code        - Validated currency code (3–5 uppercase letters)
 * @returns 'updated' | 'not_found'
 *
 * SEC-03: UPDATE inside withTenantTransaction, explicit WHERE id = $1.
 * SEC-12: code NOT logged — only workspaceId and action logged.
 */
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
        `UPDATE workspaces
         SET default_currency = $1
         WHERE id = $2`,
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

/**
 * Update workspaces.timezone for the given workspace.
 *
 * The timezone value is stored for future use in Phase 2.6 (local-time reminders).
 * It is NOT used in any transaction, report, or balance calculation in this phase.
 *
 * @param workspaceId - Internal workspace ULID (trusted backend — SEC-03)
 * @param userId      - Internal user ULID
 * @param zone        - Validated IANA timezone string
 * @returns 'updated' | 'not_found'
 *
 * SEC-03: UPDATE inside withTenantTransaction, explicit WHERE id = $1.
 */
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
        `UPDATE workspaces
         SET timezone = $1
         WHERE id = $2`,
        [zone, workspaceId],
      );
      return result.rowCount ?? 0;
    },
  );
  return rowsAffected === 0 ? 'not_found' : 'updated';
}

// ─────────────────────────────────────────────────────────────
// formatSettingsView
// ─────────────────────────────────────────────────────────────

/**
 * Format the /settings view output (read-only).
 *
 * escapeHtml applied to all DB-sourced values (SEC-03, Phase 1.15 hardening).
 */
export function formatSettingsView(settings: WorkspaceSettings): string {
  const currency = escapeHtml(settings.default_currency);
  const timezone = escapeHtml(settings.timezone);
  return (
    '⚙️ <b>Настройки Midas</b>\n\n' +
    `💵 Базовая валюта: <b>${currency}</b>\n` +
    `🕐 Часовой пояс: <b>${timezone}</b>\n\n` +
    'Изменить:\n' +
    '  /settings currency <КОД> — сменить валюту\n' +
    '  /settings timezone <Зона> — сменить часовой пояс\n\n' +
    'Примеры:\n' +
    '  /settings currency BTC\n' +
    '  /settings timezone Europe/Moscow'
  );
}

/**
 * Format confirmation after currency update.
 *
 * escapeHtml applied to all values.
 */
export function formatCurrencyUpdated(newCode: string, oldCode: string): string {
  return (
    `✅ Базовая валюта обновлена: <b>${escapeHtml(newCode)}</b>\n` +
    `   (было: ${escapeHtml(oldCode)})\n\n` +
    'Новые транзакции без явной валюты будут записаны в ' +
    `<b>${escapeHtml(newCode)}</b>.\n` +
    'Прошлые транзакции не изменены.'
  );
}

/**
 * Format confirmation after timezone update.
 */
export function formatTimezoneUpdated(newZone: string, oldZone: string): string {
  return (
    `✅ Часовой пояс обновлён: <b>${escapeHtml(newZone)}</b>\n` +
    `   (было: ${escapeHtml(oldZone)})`
  );
}
