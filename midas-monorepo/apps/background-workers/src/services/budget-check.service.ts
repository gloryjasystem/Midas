/**
 * Budget Check Service — Phase 7.0-B
 *
 * Called non-fatally by confirmation.worker after a transaction is approved.
 * Checks if any budget limit has crossed 80% or 100% threshold and
 * returns warning payloads to be enqueued as notifications.
 *
 * Design:
 *  - Non-fatal: wrapped in try-catch in confirmation.worker — MUST NOT throw
 *  - Only fires for 'expense' intent transactions
 *  - 80% alert fires ONCE per period (Redis dedup key TTL = 30d)
 *  - 100% alert fires ONCE per period (Redis dedup key TTL = 30d)
 */

import { withTenantTransaction } from '@midas/database';
import type { Redis } from 'ioredis';

export interface BudgetWarning {
  text: string;
  keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}

interface BudgetLimitRow {
  id: string;
  category_id: string;
  category_name: string;
  category_icon: string | null;
  limit_amount: string;
  limit_currency: string;
  period: string;
  spent_amount: string;
}

interface ApproveResult {
  outcome: string;
  categoryId?: string;
  amount?: string;
  currency?: string;
  intent?: string;
}

/**
 * Check budget limits after a transaction is confirmed.
 * Returns an array of warning objects (empty if none exceeded).
 */
export async function checkBudgetAfterConfirm(
  workspaceId: string,
  userId: string,
  result: ApproveResult,
  redisConnection: Redis,
): Promise<BudgetWarning[]> {
  // Only check expense transactions
  if (result.outcome !== 'approved') return [];
  if (result.intent !== 'expense' && result.intent !== undefined) return [];

  const warnings: BudgetWarning[] = [];

  try {
    await withTenantTransaction(workspaceId, userId, async (client) => {
      // Get all active budget limits with current period spending
      const r = await client.query<BudgetLimitRow>(
        `SELECT bl.id, bl.category_id,
                c.name AS category_name, COALESCE(c.icon, '📁') AS category_icon,
                bl.limit_amount::text, bl.limit_currency, bl.period,
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
         WHERE bl.workspace_id = $1 AND bl.is_active = true`,
        [workspaceId],
      );

      for (const row of r.rows) {
        const limit = parseFloat(row.limit_amount);
        const spent = parseFloat(row.spent_amount);
        if (limit <= 0) continue;

        const percent = Math.round((spent / limit) * 100);
        const icon = row.category_icon ?? '📁';
        const name = row.category_name;
        const cur = row.limit_currency;

        // Check 100% threshold
        if (percent >= 100) {
          const dedupKey = `midas:bud:alert:100:${workspaceId}:${row.id}`;
          const alreadySent = await redisConnection.get(dedupKey);
          if (!alreadySent) {
            await redisConnection.set(dedupKey, '1', 'EX', 86400 * 30);
            const overage = spent - limit;
            let text = `⛔ <b>Лимит «${name}» превышен!</b>\n\n`;
            text += `Потрачено: ${formatAmt(row.spent_amount)} / ${formatAmt(row.limit_amount)} ${cur}\n`;
            text += `Перерасход: ${formatAmt(String(overage))} ${cur}`;
            warnings.push({
              text,
              keyboard: {
                inline_keyboard: [
                  [{ text: '📊 Подробнее', callback_data: `bud:v:${row.id}` }],
                  [{ text: '✖️ Закрыть', callback_data: 'bud:close' }],
                ],
              },
            });
          }
        }
        // Check 80% threshold (only if not already at 100%)
        else if (percent >= 80) {
          const dedupKey = `midas:bud:alert:80:${workspaceId}:${row.id}`;
          const alreadySent = await redisConnection.get(dedupKey);
          if (!alreadySent) {
            await redisConnection.set(dedupKey, '1', 'EX', 86400 * 30);
            const remaining = limit - spent;
            // Days remaining in period
            const now = new Date();
            let daysLeft = 1;
            if (row.period === 'monthly') {
              const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
              daysLeft = Math.max(1, lastDay - now.getDate());
            } else if (row.period === 'weekly') {
              daysLeft = Math.max(1, 7 - now.getDay());
            }
            const perDay = daysLeft > 0 ? Math.round(remaining / daysLeft) : 0;

            let text = `⚠️ <b>Лимит «${name}» — ${String(percent)}%</b>\n\n`;
            text += `${icon} Потрачено: ${formatAmt(row.spent_amount)} / ${formatAmt(row.limit_amount)} ${cur}\n`;
            text += `Осталось: ${formatAmt(String(remaining))} ${cur} на ${String(daysLeft)} дн.\n`;
            text += `💡 ~${formatAmt(String(perDay))} ${cur} / день`;
            warnings.push({
              text,
              keyboard: {
                inline_keyboard: [
                  [{ text: '📊 Подробнее', callback_data: `bud:v:${row.id}` }],
                  [{ text: '✖️ Закрыть', callback_data: 'bud:close' }],
                ],
              },
            });
          }
        }
      }
    });
  } catch {
    // Non-fatal — return whatever warnings were collected before the error
  }

  return warnings;
}

function formatAmt(val: string): string {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}
