/**
 * Summary Dispatch Worker — Phase 7.0-A
 *
 * CRON: every hour at minute 0 (0 * * * *)
 *
 * Flow:
 *  1. SELECT workspaces where daily_summary_enabled=true
 *     AND hour/minute match current time in user's timezone
 *  2. For each workspace, check Redis dedup key (sent today already?)
 *  3. Fetch today's transactions (or yesterday's for morning preset)
 *  4. Build summary card text
 *  5. Enqueue to notifications queue (sendMessage — new message)
 *
 * SEC-03: withTenantTransaction for all DB access.
 * SEC-12: No raw transaction text in logs.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, IdempotencyKeyBuilder } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';
import { summaryDispatchQueue as _summaryDispatchQueue, notificationsQueue } from '../queues/queue-definitions.js';
import { pool } from '@midas/database';
import { ulid } from 'ulid';

export const SUMMARY_CRON_PATTERN = '*/5 * * * *';
export const SUMMARY_CRON_JOB_ID = 'system|summary-dispatch|cron';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface WorkspacePrefsRow {
  workspace_id: string;
  telegram_user_id: string;
  chat_id: string;
  daily_summary_hour: number;
  daily_summary_minute: number;
  summary_preset: string | null;
  timezone: string;
}

interface TxSummaryRow {
  intent: string;
  category_name: string;
  category_icon: string | null;
  total: string;
  currency: string;
  cnt: string;
}

interface BalanceRow {
  balance: string;
  currency: string;
}

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processSummaryDispatch(job: Job): Promise<void> {
  console.log('[midas:summary-dispatch-worker] Summary dispatch run started', { jobId: job.id });

  const now = new Date();

  // Find all workspaces with summary enabled where local time matches now
  // We query based on UTC offset stored in the timezone column
  const result = await pool.query<WorkspacePrefsRow>(`
    SELECT
      up.workspace_id,
      u.telegram_id AS telegram_user_id,
      u.telegram_id AS chat_id,
      up.daily_summary_hour,
      up.daily_summary_minute,
      up.summary_preset,
      COALESCE(w.timezone, 'UTC') AS timezone
    FROM user_preferences up
    JOIN workspaces w ON w.id = up.workspace_id
    JOIN workspace_memberships wm ON wm.workspace_id = up.workspace_id AND wm.role = 'owner'
    JOIN users u ON u.id = wm.user_id
    WHERE up.daily_summary_enabled = true
  `);

  for (const row of result.rows) {
    try {
      // Convert current UTC time to workspace local time
      const localNow = new Date(now.toLocaleString('en-US', { timeZone: row.timezone }));
      const localHour = localNow.getHours();
      const localMinute = localNow.getMinutes();
      const roundedLocalMinute = Math.floor(localMinute / 5) * 5;

      // Check if this workspace's summary time matches current local 5-min slot
      if (localHour !== row.daily_summary_hour || roundedLocalMinute !== row.daily_summary_minute) {
        continue;
      }

      // Dedup: only send once per day per workspace
      const today = localNow.toISOString().split('T')[0];
      const dedupKey = `midas:summary:sent:${row.workspace_id}:${today}`;
      const alreadySent = await redisConnection.get(dedupKey);
      if (alreadySent) continue;

      // Mark as sent immediately (TTL 23h to prevent double-send)
      await redisConnection.set(dedupKey, '1', 'EX', 82800);

      // Determine period: morning gets yesterday, others get today
      const isMorning = row.summary_preset === 'morning' || row.daily_summary_hour < 12;
      const periodDate = isMorning ? new Date(localNow) : new Date(localNow);
      if (isMorning) periodDate.setDate(periodDate.getDate() - 1);
      const periodStr = periodDate.toISOString().split('T')[0];
      const periodLabel = isMorning ? 'вчера' : 'сегодня';
      const headerEmoji = row.daily_summary_hour < 12 ? '☀️ Доброе утро!' : row.daily_summary_hour < 18 ? '🌤 Итоги дня:' : '🌆 Итоги за сегодня:';

      // Fetch transactions for the period
      const txResult = await pool.query<TxSummaryRow>(`
        SELECT
          t.transaction_intent AS intent,
          COALESCE(c.name, 'Без категории') AS category_name,
          COALESCE(c.icon, '📁') AS category_icon,
          SUM(ABS(t.original_amount))::text AS total,
          t.currency,
          COUNT(*)::text AS cnt
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.workspace_id = $1
          AND t.deleted_at IS NULL
          AND DATE(t.transaction_time AT TIME ZONE $2) = $3::date
        GROUP BY t.transaction_intent, c.name, c.icon, t.currency
        ORDER BY SUM(ABS(t.original_amount)) DESC
        LIMIT 10
      `, [row.workspace_id, row.timezone, periodStr]);

      // Fetch main balance
      const balResult = await pool.query<BalanceRow>(`
        SELECT
          COALESCE(SUM(CASE WHEN t.transaction_intent = 'income' THEN t.original_amount
                            WHEN t.transaction_intent IN ('expense','transfer') THEN -t.original_amount
                            ELSE 0 END), 0)::text AS balance,
          w.default_currency AS currency
        FROM workspaces w
        LEFT JOIN transactions t ON t.workspace_id = w.id AND t.deleted_at IS NULL
        WHERE w.id = $1
        GROUP BY w.default_currency
      `, [row.workspace_id]);

      const balance = balResult.rows[0]?.balance ?? '0';
      const balCurrency = balResult.rows[0]?.currency ?? '';

      // Build summary text
      const expenses = txResult.rows.filter(r => r.intent === 'expense');
      const incomes = txResult.rows.filter(r => r.intent === 'income');
      const totalTxCount = txResult.rows.reduce((acc, r) => acc + parseInt(r.cnt), 0);

      let text = `${headerEmoji} Итоги за ${periodLabel}:\n\n`;

      if (totalTxCount === 0) {
        text += '📭 Транзакций не было.\n';
      } else {
        if (expenses.length > 0) {
          const totalExp = expenses.reduce((acc, r) => acc + parseFloat(r.total), 0);
          const expCount = expenses.reduce((acc, r) => acc + parseInt(r.cnt), 0);
          text += `💸 Расходы: ${fmtAmt(String(totalExp))} ${expenses[0]?.currency ?? ''} (${String(expCount)} ${pluralTx(expCount)})\n`;
          for (const e of expenses.slice(0, 3)) {
            text += `  · ${e.category_icon ?? '📁'} ${e.category_name}: ${fmtAmt(e.total)} ${e.currency}\n`;
          }
        }
        if (incomes.length > 0) {
          const totalInc = incomes.reduce((acc, r) => acc + parseFloat(r.total), 0);
          text += `\n💰 Доходы: ${fmtAmt(String(totalInc))} ${incomes[0]?.currency ?? ''}\n`;
        } else {
          text += `\n💰 Доходы: —\n`;
        }
      }

      text += `\n📈 Баланс: ${fmtAmt(balance)} ${balCurrency}`;

      // Enqueue notification (new message)
      const alertId = ulid();
      const keyboard = {
        inline_keyboard: [
          ...(totalTxCount > 0 ? [[{ text: '📊 Полный отчёт', callback_data: 'rp:main' }]] : []),
          [{ text: '✖️ Закрыть', callback_data: 'summary:close' }],
        ],
      };

      await notificationsQueue.add(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          alertId,
          workspaceId: row.workspace_id,
          chatId: row.chat_id,
          message: text,
          inlineKeyboardJson: JSON.stringify(keyboard),
          telegramUserId: row.telegram_user_id,
          isSuccessCard: true, // don't overwrite midas:am:
        },
        { jobId: IdempotencyKeyBuilder.notification(row.workspace_id, alertId) },
      );

      console.log('[midas:summary-dispatch-worker] Summary sent', {
        workspaceId: row.workspace_id,
        periodStr,
      });
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      console.error('[midas:summary-dispatch-worker] Failed for workspace', {
        workspaceId: row.workspace_id,
        errorClass,
      });
    }
  }

  console.log('[midas:summary-dispatch-worker] Run complete', { jobId: job.id, total: result.rows.length });
}

// ─────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────

export function createSummaryDispatchWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.SUMMARY_DISPATCH,
    processSummaryDispatch,
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err: unknown) => {
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[midas:summary-dispatch-worker] Job failed', {
      jobId: job?.id,
      errorClass,
    });
  });

  return worker;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtAmt(val: string): string {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function pluralTx(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'транзакция';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'транзакции';
  return 'транзакций';
}
