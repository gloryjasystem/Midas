/**
 * Budget Service — Phase 7.0-B
 *
 * CRUD operations for per-category spending limits.
 * All SQL via withTenantTransaction (SEC-03).
 * Amounts stay as NUMERIC strings (SEC-02).
 */

import { withTenantTransaction } from '@midas/database';
import { ulid } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface BudgetLimit {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  limitAmount: string;
  limitCurrency: string;
  period: string;
  isActive: boolean;
  spentAmount: string;
  spentPercent: number;
}

interface BudgetRow {
  id: string;
  category_id: string;
  category_name: string;
  category_icon: string | null;
  limit_amount: string;
  limit_currency: string;
  period: string;
  is_active: boolean;
  spent_amount: string | null;
}

// ─────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────

/**
 * Get count of active budget limits for a workspace.
 */
export async function getBudgetCount(
  workspaceId: string,
  userId: string,
): Promise<number> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM budget_limits
       WHERE workspace_id = $1 AND is_active = true`,
      [workspaceId],
    );
    return parseInt(r.rows[0]?.cnt ?? '0', 10);
  });
}

/**
 * Get all budget limits with spent amounts for current period.
 */
export async function getBudgetLimits(
  workspaceId: string,
  userId: string,
): Promise<BudgetLimit[]> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<BudgetRow>(
      `SELECT bl.id, bl.category_id, c.name AS category_name,
              COALESCE(c.icon, '📁') AS category_icon,
              bl.limit_amount::text, bl.limit_currency, bl.period, bl.is_active,
              COALESCE((
                SELECT SUM(ABS(t.original_amount))::text
                FROM transactions t
                WHERE t.workspace_id = $1
                  AND t.category_id = bl.category_id
                  AND t.deleted_at IS NULL
                  AND t.transaction_intent = 'expense'
                  AND t.transaction_time >= date_trunc(
                    CASE bl.period
                      WHEN 'daily' THEN 'day'
                      WHEN 'weekly' THEN 'week'
                      WHEN 'monthly' THEN 'month'
                    END, NOW()
                  )
              ), '0') AS spent_amount
       FROM budget_limits bl
       JOIN categories c ON c.id = bl.category_id
       WHERE bl.workspace_id = $1 AND bl.is_active = true
       ORDER BY bl.created_at`,
      [workspaceId],
    );

    return r.rows.map((row) => {
      const limit = parseFloat(row.limit_amount);
      const spent = parseFloat(row.spent_amount ?? '0');
      return {
        id: row.id,
        categoryId: row.category_id,
        categoryName: row.category_name,
        categoryIcon: row.category_icon ?? '📁',
        limitAmount: row.limit_amount,
        limitCurrency: row.limit_currency,
        period: row.period,
        isActive: row.is_active,
        spentAmount: row.spent_amount ?? '0',
        spentPercent: limit > 0 ? Math.round((spent / limit) * 100) : 0,
      };
    });
  });
}

/**
 * Get a single budget limit detail.
 */
export async function getBudgetDetail(
  workspaceId: string,
  userId: string,
  limitId: string,
): Promise<BudgetLimit | null> {
  const limits = await getBudgetLimits(workspaceId, userId);
  return limits.find((l) => l.id === limitId) ?? null;
}

// ─────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────

/**
 * Create a new budget limit.
 */
export async function createBudgetLimit(
  workspaceId: string,
  userId: string,
  categoryId: string,
  amount: number,
  currency: string,
  period: string = 'monthly',
): Promise<string> {
  const id = ulid();
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `INSERT INTO budget_limits (id, workspace_id, category_id, limit_amount, limit_currency, period)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, category_id) DO UPDATE
       SET limit_amount = $4, limit_currency = $5, period = $6, is_active = true, updated_at = NOW()`,
      [id, workspaceId, categoryId, amount, currency, period],
    );
  });
  return id;
}

/**
 * Update a budget limit amount.
 */
export async function updateBudgetAmount(
  workspaceId: string,
  userId: string,
  limitId: string,
  newAmount: number,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `UPDATE budget_limits SET limit_amount = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3`,
      [newAmount, limitId, workspaceId],
    );
  });
}

/**
 * Delete a budget limit.
 */
export async function deleteBudgetLimit(
  workspaceId: string,
  userId: string,
  limitId: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `DELETE FROM budget_limits WHERE id = $1 AND workspace_id = $2`,
      [limitId, workspaceId],
    );
  });
}

// ─────────────────────────────────────────────────────────────
// Screen builders
// ─────────────────────────────────────────────────────────────

function formatAmount(val: string): string {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

const PERIOD_LABELS: Record<string, string> = {
  daily: 'в день',
  weekly: 'в неделю',
  monthly: 'в месяц',
};

/**
 * Build the budget list screen (Экран 2.1).
 */
export function getBudgetListScreen(
  workspaceId: string,
  userId: string,
): Promise<{ text: string; keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }> {
  return getBudgetLimits(workspaceId, userId).then((limits) => {
    if (limits.length === 0) {
      return {
        text: '💰 <b>Лимиты расходов</b>\n\nУстановите лимит на категорию,\nчтобы бот предупреждал при 80% и 100%.\n\nПока нет ни одного лимита.',
        keyboard: {
          inline_keyboard: [
            [{ text: '➕ Добавить лимит', callback_data: 'bud:add' }],
            [{ text: '🔙 Назад', callback_data: 'st:ntf' }],
          ],
        },
      };
    }

    let text = '💰 <b>Лимиты расходов</b>\n\nБот предупредит при 80% и 100%.';
    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

    for (const l of limits) {
      const warn = l.spentPercent >= 80 ? ' ⚠️' : '';
      buttons.push([{
        text: `${l.categoryIcon} ${l.categoryName}  ${String(l.spentPercent)}%${warn}`,
        callback_data: `bud:v:${l.id}`,
      }]);
    }
    buttons.push([{ text: '➕ Добавить лимит', callback_data: 'bud:add' }]);
    buttons.push([{ text: '🔙 Назад', callback_data: 'st:ntf' }]);

    return { text, keyboard: { inline_keyboard: buttons } };
  });
}

/**
 * Build the budget detail screen (Экран 2.2).
 */
export function buildBudgetDetailScreen(limit: BudgetLimit): { text: string; keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
  const spent = parseFloat(limit.spentAmount);
  const total = parseFloat(limit.limitAmount);
  const warn = limit.spentPercent >= 100 ? ' ⛔' : limit.spentPercent >= 80 ? ' ⚠️' : '';
  const periodLabel = PERIOD_LABELS[limit.period] ?? limit.period;

  // Days remaining in period
  const now = new Date();
  let daysLeft = 1;
  if (limit.period === 'monthly') {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    daysLeft = Math.max(1, lastDay - now.getDate());
  } else if (limit.period === 'weekly') {
    daysLeft = Math.max(1, 7 - now.getDay());
  }

  const remaining = Math.max(0, total - spent);
  const perDay = daysLeft > 0 ? Math.round(remaining / daysLeft) : 0;

  let text = `${limit.categoryIcon} <b>${limit.categoryName}</b> · Лимит\n\n`;
  text += `💰 Лимит: ${formatAmount(limit.limitAmount)} ${limit.limitCurrency} ${periodLabel}\n`;
  text += `📊 Потрачено: ${formatAmount(limit.spentAmount)} ${limit.limitCurrency} (${String(limit.spentPercent)}%)${warn}\n`;
  text += `📅 Осталось дней: ${String(daysLeft)}\n`;
  text += `💸 Можно тратить: ~${formatAmount(String(perDay))} ${limit.limitCurrency}/день`;

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '✏️ Изменить сумму', callback_data: `bud:edit:${limit.id}` }],
        [{ text: '🗑️ Удалить лимит', callback_data: `bud:del:${limit.id}` }],
        [{ text: '🔙 Назад', callback_data: 'bud:list' }],
      ],
    },
  };
}

/**
 * Get categories available for new limits (excluding already-limited).
 */
export async function getAvailableCategories(
  workspaceId: string,
  userId: string,
): Promise<Array<{ id: string; name: string; icon: string }>> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<{ id: string; name: string; icon: string | null }>(
      `SELECT c.id, c.name, COALESCE(c.icon, '📁') AS icon
       FROM categories c
       WHERE c.workspace_id = $1
         AND c.id NOT IN (SELECT category_id FROM budget_limits WHERE workspace_id = $1 AND is_active = true)
       ORDER BY c.name
       LIMIT 20`,
      [workspaceId],
    );
    return r.rows.map((row) => ({ id: row.id, name: row.name, icon: row.icon ?? '📁' }));
  });
}

/**
 * Get a Set of category IDs that already have an active budget limit.
 * Used by the grouped category picker to filter out already-limited categories.
 */
export async function getBudgetLimitIds(
  workspaceId: string,
  userId: string,
): Promise<Set<string>> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<{ category_id: string }>(
      `SELECT category_id FROM budget_limits WHERE workspace_id = $1 AND is_active = true`,
      [workspaceId],
    );
    return new Set(r.rows.map((row) => row.category_id));
  });
}
