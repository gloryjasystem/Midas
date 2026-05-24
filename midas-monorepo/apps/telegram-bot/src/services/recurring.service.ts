/**
 * Recurring Service — Phase 7.0-C
 *
 * CRUD for recurring transactions (subscriptions).
 * All SQL via withTenantTransaction (SEC-03).
 * Amounts stay as NUMERIC strings (SEC-02).
 */

import { withTenantTransaction } from '@midas/database';
import { ulid } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface RecurringTx {
  id: string;
  amount: string;
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string;
  accountId: string | null;
  accountName: string | null;
  intent: string;
  itemName: string | null;
  frequency: string;
  dayOfMonth: number | null;
  nextFireDate: string;
  isActive: boolean;
  timesFired: number;
}

interface RecurringRow {
  id: string;
  amount: string;
  currency: string;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  account_id: string | null;
  account_name: string | null;
  intent: string;
  item_name: string | null;
  frequency: string;
  day_of_month: number | null;
  next_fire_date: string;
  is_active: boolean;
  times_fired: number;
}

const FREQ_LABELS: Record<string, string> = {
  daily: 'ежедневно',
  weekly: 'еженедельно',
  monthly: 'ежемесячно',
  yearly: 'ежегодно',
};

// ─────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────

export async function getRecurringCount(
  workspaceId: string,
  userId: string,
): Promise<number> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM recurring_transactions
       WHERE workspace_id = $1 AND is_active = true`,
      [workspaceId],
    );
    return parseInt(r.rows[0]?.cnt ?? '0', 10);
  });
}

export async function getRecurringList(
  workspaceId: string,
  userId: string,
): Promise<RecurringTx[]> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<RecurringRow>(
      `SELECT rt.id, rt.amount::text, rt.currency, rt.category_id,
              COALESCE(c.name, '') AS category_name, COALESCE(c.icon, '📁') AS category_icon,
              rt.account_id, COALESCE(a.name, '') AS account_name,
              rt.intent, rt.item_name, rt.frequency, rt.day_of_month,
              rt.next_fire_date::text, rt.is_active, rt.times_fired
       FROM recurring_transactions rt
       LEFT JOIN categories c ON c.id = rt.category_id
       LEFT JOIN account_sources a ON a.id = rt.account_id
       WHERE rt.workspace_id = $1 AND rt.is_active = true
       ORDER BY rt.next_fire_date`,
      [workspaceId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      currency: row.currency,
      categoryId: row.category_id,
      categoryName: row.category_name,
      categoryIcon: row.category_icon ?? '📁',
      accountId: row.account_id,
      accountName: row.account_name,
      intent: row.intent,
      itemName: row.item_name,
      frequency: row.frequency,
      dayOfMonth: row.day_of_month,
      nextFireDate: row.next_fire_date,
      isActive: row.is_active,
      timesFired: row.times_fired,
    }));
  });
}

export async function getRecurringDetail(
  workspaceId: string,
  userId: string,
  recurringId: string,
): Promise<RecurringTx | null> {
  const list = await getRecurringList(workspaceId, userId);
  return list.find((r) => r.id === recurringId) ?? null;
}

// ─────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────

export async function createRecurring(
  workspaceId: string,
  userId: string,
  data: {
    amount: number;
    currency: string;
    itemName: string;
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  },
): Promise<string> {
  const id = ulid();
  const nextFire = calcNextFireDate(data.frequency);

  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `INSERT INTO recurring_transactions
       (id, workspace_id, amount, currency, item_name, frequency, day_of_month, next_fire_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, workspaceId, data.amount, data.currency, data.itemName, data.frequency,
       data.frequency === 'monthly' ? new Date().getDate() : null, nextFire],
    );
  });
  return id;
}

export async function deleteRecurring(
  workspaceId: string,
  userId: string,
  recurringId: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `DELETE FROM recurring_transactions WHERE id = $1 AND workspace_id = $2`,
      [recurringId, workspaceId],
    );
  });
}

export async function pauseRecurring(
  workspaceId: string,
  userId: string,
  recurringId: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `UPDATE recurring_transactions SET is_active = false WHERE id = $1 AND workspace_id = $2`,
      [recurringId, workspaceId],
    );
  });
}

export async function resumeRecurring(
  workspaceId: string,
  userId: string,
  recurringId: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `UPDATE recurring_transactions SET is_active = true, next_fire_date = CURRENT_DATE
       WHERE id = $1 AND workspace_id = $2`,
      [recurringId, workspaceId],
    );
  });
}

export async function updateRecurringAmount(
  workspaceId: string,
  userId: string,
  recurringId: string,
  newAmount: number,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `UPDATE recurring_transactions SET amount = $1 WHERE id = $2 AND workspace_id = $3`,
      [newAmount, recurringId, workspaceId],
    );
  });
}

export async function fireRecurringTx(
  workspaceId: string,
  userId: string,
  recurringId: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    // Get recurring template
    const r = await client.query<RecurringRow>(
      `SELECT * FROM recurring_transactions WHERE id = $1 AND workspace_id = $2`,
      [recurringId, workspaceId],
    );
    const rec = r.rows[0];
    if (!rec) return;

    // Insert actual transaction
    const txId = ulid();
    await client.query(
      `INSERT INTO transactions
       (id, workspace_id, original_amount, currency, category_id, account_id,
        transaction_intent, item_name, transaction_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [txId, workspaceId, rec.amount, rec.currency, rec.category_id, rec.account_id,
       rec.intent, rec.item_name],
    );

    // Advance next_fire_date + increment counter
    const interval = getIntervalSql(rec.frequency);
    await client.query(
      `UPDATE recurring_transactions
       SET next_fire_date = next_fire_date + ${interval},
           times_fired = times_fired + 1,
           last_fired_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [recurringId, workspaceId],
    );
  });
}

export async function skipRecurringTx(
  workspaceId: string,
  userId: string,
  recurringId: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<{ frequency: string }>(
      `SELECT frequency FROM recurring_transactions WHERE id = $1 AND workspace_id = $2`,
      [recurringId, workspaceId],
    );
    const freq = r.rows[0]?.frequency ?? 'monthly';
    const interval = getIntervalSql(freq);
    await client.query(
      `UPDATE recurring_transactions
       SET next_fire_date = next_fire_date + ${interval}
       WHERE id = $1 AND workspace_id = $2`,
      [recurringId, workspaceId],
    );
  });
}

// ─────────────────────────────────────────────────────────────
// Screen builders
// ─────────────────────────────────────────────────────────────

function formatAmount(val: string): string {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getRecurringListScreen(
  workspaceId: string,
  userId: string,
): Promise<{ text: string; keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }> {
  return getRecurringList(workspaceId, userId).then((list) => {
    if (list.length === 0) {
      return {
        text: '🔄 <b>Регулярные платежи</b>\n\nДобавьте повторяющиеся платежи,\nи бот будет напоминать о них.\n\nПока нет ни одной подписки.',
        keyboard: {
          inline_keyboard: [
            [{ text: '➕ Добавить подписку', callback_data: 'sub:add' }],
            [{ text: '🔙 Назад', callback_data: 'st:ntf' }],
          ],
        },
      };
    }

    let text = '🔄 <b>Регулярные платежи</b>\n\nБот напоминает в день платежа.';
    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

    for (const r of list) {
      const name = r.itemName ?? r.categoryName ?? '—';
      const dateLabel = formatDate(r.nextFireDate);
      buttons.push([{
        text: `${r.categoryIcon} ${name}  ${formatAmount(r.amount)} ${r.currency} · ${dateLabel}`,
        callback_data: `sub:v:${r.id}`,
      }]);
    }
    buttons.push([{ text: '➕ Добавить подписку', callback_data: 'sub:add' }]);
    buttons.push([{ text: '🔙 Назад', callback_data: 'st:ntf' }]);

    return { text, keyboard: { inline_keyboard: buttons } };
  });
}

export function buildRecurringDetailScreen(rec: RecurringTx): { text: string; keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
  const name = rec.itemName ?? rec.categoryName ?? '—';
  const freqLabel = FREQ_LABELS[rec.frequency] ?? rec.frequency;
  const dateStr = formatDate(rec.nextFireDate);

  let text = `${rec.categoryIcon} <b>${name}</b> · Подписка\n\n`;
  text += `💰 Сумма: ${formatAmount(rec.amount)} ${rec.currency}\n`;
  text += `📅 Частота: ${freqLabel}\n`;
  text += `📆 Следующий платёж: ${dateStr}\n`;
  text += `🔄 Всего оплат: ${String(rec.timesFired)}`;

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '✏️ Изменить сумму', callback_data: `sub:eamt:${rec.id}` }],
        [{ text: '⏸ Приостановить', callback_data: `sub:pause:${rec.id}` }],
        [{ text: '🗑️ Удалить', callback_data: `sub:del:${rec.id}` }],
        [{ text: '🔙 Назад', callback_data: 'sub:list' }],
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function calcNextFireDate(frequency: string): string {
  const now = new Date();
  switch (frequency) {
    case 'daily':
      now.setDate(now.getDate() + 1);
      break;
    case 'weekly':
      now.setDate(now.getDate() + 7);
      break;
    case 'monthly':
      now.setMonth(now.getMonth() + 1);
      break;
    case 'yearly':
      now.setFullYear(now.getFullYear() + 1);
      break;
  }
  return now.toISOString().split('T')[0] ?? now.toISOString().slice(0, 10);
}

function getIntervalSql(frequency: string): string {
  switch (frequency) {
    case 'daily': return "INTERVAL '1 day'";
    case 'weekly': return "INTERVAL '1 week'";
    case 'monthly': return "INTERVAL '1 month'";
    case 'yearly': return "INTERVAL '1 year'";
    default: return "INTERVAL '1 month'";
  }
}
