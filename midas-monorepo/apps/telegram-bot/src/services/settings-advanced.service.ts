/**
 * Settings Advanced Service — Phase 2.0 Sprint 5
 *
 * Provides advanced settings functions for Phase 2.0:
 *   - User preferences CRUD (notifications, number format, language)
 *   - Workspace stats ("About bot")
 *   - CSV export
 *
 * Design:
 *   D1: All SQL via withTenantTransaction (SEC-03).
 *   D2: Amounts stay as NUMERIC strings (SEC-02). parseFloat only for display.
 *   D3: All DB-sourced strings pass through escapeHtml.
 *   D4: Preferences are lazily created (find-or-create pattern).
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';
import { ulid } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface UserPrefs {
  dailySummaryEnabled: boolean;
  dailySummaryHour: number;
  limitAlertsEnabled: boolean;
  recordReminderEnabled: boolean;
  numberFormat: 'ru' | 'en' | 'de';
  language: 'ru' | 'en' | 'ua';
}

export interface WorkspaceStats {
  totalTransactions: number;
  totalCategories: number;
  totalAccounts: number;
  firstRecordDate: string | null;
  daysUsing: number;
}

// ─────────────────────────────────────────────────────────────
// Preferences
// ─────────────────────────────────────────────────────────────

interface PrefsRow {
  daily_summary_enabled: boolean;
  daily_summary_hour: number;
  limit_alerts_enabled: boolean;
  record_reminder_enabled: boolean;
  number_format: string;
  language: string;
}

/**
 * Get or create user preferences for a workspace.
 * Uses find-or-create to ensure a row always exists.
 */
export async function getUserPreferences(
  workspaceId: string,
  userId: string,
): Promise<UserPrefs> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    // Try to find existing
    const r = await client.query<PrefsRow>(
      `SELECT daily_summary_enabled, daily_summary_hour,
              limit_alerts_enabled, record_reminder_enabled,
              number_format, language
       FROM user_preferences WHERE workspace_id = $1`,
      [workspaceId],
    );

    if (r.rows[0]) {
      const row = r.rows[0];
      return {
        dailySummaryEnabled: row.daily_summary_enabled,
        dailySummaryHour: row.daily_summary_hour,
        limitAlertsEnabled: row.limit_alerts_enabled,
        recordReminderEnabled: row.record_reminder_enabled,
        numberFormat: row.number_format as UserPrefs['numberFormat'],
        language: row.language as UserPrefs['language'],
      };
    }

    // Create default prefs
    await client.query(
      `INSERT INTO user_preferences (id, workspace_id)
       VALUES ($1, $2) ON CONFLICT (workspace_id) DO NOTHING`,
      [ulid(), workspaceId],
    );

    return {
      dailySummaryEnabled: false,
      dailySummaryHour: 21,
      limitAlertsEnabled: false,
      recordReminderEnabled: false,
      numberFormat: 'ru',
      language: 'ru',
    };
  });
}

/**
 * Update a notification setting (toggle).
 */
export async function updateNotificationSetting(
  workspaceId: string,
  userId: string,
  key: 'daily_summary_enabled' | 'limit_alerts_enabled' | 'record_reminder_enabled',
  value: boolean,
): Promise<void> {
  const ALLOWED_KEYS = new Set([
    'daily_summary_enabled',
    'limit_alerts_enabled',
    'record_reminder_enabled',
  ]);
  if (!ALLOWED_KEYS.has(key)) throw new Error(`Invalid notification key: ${key}`);

  await withTenantTransaction(workspaceId, userId, async (client) => {
    // Ensure prefs row exists
    await client.query(
      `INSERT INTO user_preferences (id, workspace_id)
       VALUES ($1, $2) ON CONFLICT (workspace_id) DO NOTHING`,
      [ulid(), workspaceId],
    );

    // Update using safe column reference via allowlist (no interpolation in SQL)
    if (key === 'daily_summary_enabled') {
      await client.query(
        `UPDATE user_preferences SET daily_summary_enabled = $1, updated_at = NOW() WHERE workspace_id = $2`,
        [value, workspaceId],
      );
    } else if (key === 'limit_alerts_enabled') {
      await client.query(
        `UPDATE user_preferences SET limit_alerts_enabled = $1, updated_at = NOW() WHERE workspace_id = $2`,
        [value, workspaceId],
      );
    } else {
      await client.query(
        `UPDATE user_preferences SET record_reminder_enabled = $1, updated_at = NOW() WHERE workspace_id = $2`,
        [value, workspaceId],
      );
    }
  });
}

/**
 * Update the daily summary hour.
 */
export async function updateDailySummaryHour(
  workspaceId: string,
  userId: string,
  hour: number,
): Promise<void> {
  if (hour < 0 || hour > 23) throw new Error(`Invalid hour: ${String(hour)}`);

  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `INSERT INTO user_preferences (id, workspace_id)
       VALUES ($1, $2) ON CONFLICT (workspace_id) DO NOTHING`,
      [ulid(), workspaceId],
    );
    await client.query(
      `UPDATE user_preferences SET daily_summary_hour = $1, updated_at = NOW() WHERE workspace_id = $2`,
      [hour, workspaceId],
    );
  });
}

/**
 * Update number format.
 */
export async function updateNumberFormat(
  workspaceId: string,
  userId: string,
  format: 'ru' | 'en' | 'de',
): Promise<void> {
  const ALLOWED = new Set(['ru', 'en', 'de']);
  if (!ALLOWED.has(format)) throw new Error(`Invalid format: ${format}`);

  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `INSERT INTO user_preferences (id, workspace_id)
       VALUES ($1, $2) ON CONFLICT (workspace_id) DO NOTHING`,
      [ulid(), workspaceId],
    );
    await client.query(
      `UPDATE user_preferences SET number_format = $1, updated_at = NOW() WHERE workspace_id = $2`,
      [format, workspaceId],
    );
  });
}

/**
 * Update language.
 */
export async function updateLanguage(
  workspaceId: string,
  userId: string,
  lang: 'ru' | 'en' | 'ua',
): Promise<void> {
  const ALLOWED = new Set(['ru', 'en', 'ua']);
  if (!ALLOWED.has(lang)) throw new Error(`Invalid language: ${lang}`);

  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `INSERT INTO user_preferences (id, workspace_id)
       VALUES ($1, $2) ON CONFLICT (workspace_id) DO NOTHING`,
      [ulid(), workspaceId],
    );
    await client.query(
      `UPDATE user_preferences SET language = $1, updated_at = NOW() WHERE workspace_id = $2`,
      [lang, workspaceId],
    );
  });
}

// ─────────────────────────────────────────────────────────────
// Workspace Stats
// ─────────────────────────────────────────────────────────────

interface StatsRow {
  total_tx: string;
  total_cat: string;
  total_acc: string;
  first_date: string | null;
}

/**
 * Get workspace statistics for "About bot" screen.
 */
export async function getWorkspaceStats(
  workspaceId: string,
  userId: string,
): Promise<string> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<StatsRow>(
      `SELECT
         (SELECT COUNT(*) FROM transactions WHERE workspace_id = $1 AND deleted_at IS NULL)::text AS total_tx,
         (SELECT COUNT(*) FROM categories WHERE workspace_id = $1)::text AS total_cat,
         (SELECT COUNT(*) FROM account_sources WHERE workspace_id = $1)::text AS total_acc,
         (SELECT MIN(transaction_time)::date::text FROM transactions WHERE workspace_id = $1 AND deleted_at IS NULL) AS first_date`,
      [workspaceId],
    );
    const s = r.rows[0];
    if (!s) return 'ℹ️ <b>О Midas</b>\n\nНет данных.';

    const firstDate = s.first_date
      ? escapeHtml(s.first_date.split('-').reverse().join('.'))
      : '—';

    const daysUsing = s.first_date
      ? Math.max(1, Math.ceil((Date.now() - new Date(s.first_date).getTime()) / 86_400_000))
      : 0;

    let text = 'ℹ️ <b>О Midas</b>\n\n';
    text += '📱 Версия: <b>2.0</b>\n';
    text += '📊 Статистика:\n';
    text += `     └ Всего транзакций: ${s.total_tx}\n`;
    text += `     └ Категорий: ${s.total_cat}\n`;
    text += `     └ Счетов: ${s.total_acc}\n`;
    text += `     └ Первая запись: ${firstDate}\n`;
    text += `     └ Дней использования: ${String(daysUsing)}`;

    return text;
  });
}

// ─────────────────────────────────────────────────────────────
// CSV Export
// ─────────────────────────────────────────────────────────────

interface CsvRow {
  tx_date: string;
  tx_type: string;
  base_amount: string;
  base_currency: string;
  category_name: string;
  account_name: string;
  item_name: string | null;
}

/**
 * Export transactions as CSV buffer.
 * Format: дата,тип,сумма,валюта,категория,счёт,товар
 */
export async function exportTransactionsCSV(
  workspaceId: string,
  userId: string,
  dateFrom?: Date,
  dateTo?: Date,
  accountId?: string,
): Promise<Buffer> {
  const from = dateFrom ?? new Date(0);
  const to   = dateTo   ?? new Date();

  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const accFilter = accountId ? `AND t.account_id = $4` : '';
    const params: (string | Date)[] = [workspaceId, from.toISOString(), to.toISOString()];
    if (accountId) params.push(accountId);

    const r = await client.query<CsvRow>(
      `SELECT
         t.transaction_time::date::text AS tx_date,
         t.transaction_intent AS tx_type,
         ROUND(t.original_amount, 2)::text AS base_amount,
         t.currency AS base_currency,
         COALESCE(c.name, '') AS category_name,
         COALESCE(a.name, '') AS account_name,
         COALESCE(t.item_name, '') AS item_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN account_sources a ON a.id = t.account_id
       WHERE t.workspace_id = $1
         AND t.deleted_at IS NULL
         AND t.transaction_time >= $2
         AND t.transaction_time <= $3
         ${accFilter}
       ORDER BY t.transaction_time DESC`,
      params,
    );

    const header = 'дата,тип,сумма,валюта,категория,счёт,товар\n';
    const rows = r.rows.map(row => {
      const escapeCsv = (s: string) => s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      return [
        row.tx_date,
        row.tx_type,
        row.base_amount,
        row.base_currency,
        escapeCsv(row.category_name),
        escapeCsv(row.account_name),
        escapeCsv(row.item_name ?? ''),
      ].join(',');
    });

    return Buffer.from(header + rows.join('\n'), 'utf-8');
  });
}
