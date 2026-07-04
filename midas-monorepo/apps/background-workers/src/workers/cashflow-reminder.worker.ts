/**
 * Cashflow Reminder Worker — Phase 7.1-B
 *
 * CRON: twice daily at 08:00 UTC and 20:00 UTC (0 8,20 * * *)
 *
 * Flow:
 *  1. SELECT financial_reminders WHERE status IN ('active','snoozed')
 *     AND due_date - remind_offset IS TODAY (for each offset in remind_offsets[])
 *  2. For each due reminder (per workspace, per user):
 *     a. Dedup via Redis key midas:rem:notified:{id}:{date}:{daysLeft} (TTL 26h)
 *     b. Build notification card with ✅/⏳/❌ buttons
 *     c. Enqueue to notifications queue
 *  3. Log counts per run — no amounts in logs (SEC-12)
 *
 * SEC-03: pool.query for cross-workspace discovery (no RLS token available here).
 *         Individual user-facing mutations go through withTenantTransaction in reminder.service.ts.
 * SEC-12: No raw amounts logged.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, IdempotencyKeyBuilder } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';
import { cashflowReminderQueue as _cashflowReminderQueue, notificationsQueue } from '../queues/queue-definitions.js';
import { pool } from '@midas/database';
import { ulid } from 'ulid';

export const CASHFLOW_CRON_PATTERN = '0 8,20 * * *'; // 08:00 and 20:00 UTC every day
export const CASHFLOW_CRON_JOB_ID  = 'system|cashflow-reminder|cron';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ReminderDueRow {
  id: string;
  workspace_id: string;
  telegram_user_id: string;
  title: string;
  amount: string;
  currency: string;
  reminder_type: string;
  due_date: string;       // ISO date YYYY-MM-DD
  days_until_due: number; // computed by SQL: due_date - CURRENT_DATE
  is_recurring: boolean;
  recurrence_pattern: string | null;
  counterparty: string | null;
}

const TYPE_EMOJI: Record<string, string> = {
  expense:      '💸',
  income:       '💰',
  debt_pay:     '🤝',
  debt_receive: '🤲',
};

const RECURRENCE_LABELS: Record<string, string> = {
  weekly:  '🔁 Еженедельно',
  monthly: '🔁 Ежемесячно',
  yearly:  '🔁 Ежегодно',
};

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processCashflowReminder(job: Job): Promise<void> {
  console.log('[midas:cashflow-reminder-worker] Run started', { jobId: job.id });

  // Find all reminders where today is one of the remind_offset days
  // i.e. (due_date - CURRENT_DATE) = ANY(remind_offsets)
  // We also include overdue (days_until_due < 0 AND days_until_due >= -1) — send once on overdue day
  const result = await pool.query<ReminderDueRow>(`
    SELECT
      fr.id,
      fr.workspace_id,
      u.telegram_id AS telegram_user_id,
      fr.title,
      fr.amount::text,
      fr.currency,
      fr.reminder_type,
      fr.due_date::text,
      (fr.due_date - CURRENT_DATE)::integer AS days_until_due,
      fr.is_recurring,
      fr.recurrence_pattern,
      fr.counterparty
    FROM financial_reminders fr
    JOIN workspaces w ON w.id = fr.workspace_id
    JOIN workspace_memberships wm ON wm.workspace_id = fr.workspace_id AND wm.role = 'owner'
    JOIN users u ON u.id = wm.user_id
    WHERE fr.status IN ('active', 'snoozed')
      AND (fr.due_date - CURRENT_DATE) = ANY(fr.remind_offsets)
  `);

  console.log('[midas:cashflow-reminder-worker] Due reminders found', {
    count: result.rows.length,
  });

  let sent = 0;
  let skipped = 0;

  for (const row of result.rows) {
    try {
      const daysLeft = row.days_until_due;

      // Dedup: send at most once per reminder per (date, daysLeft) combination
      const dedupKey = `midas:rem:notified:${row.id}:${row.due_date}:${String(daysLeft)}`;
      const alreadySent = await redisConnection.get(dedupKey);
      if (alreadySent) {
        skipped++;
        continue;
      }
      // TTL 26h — covers both the 08:00 and 20:00 runs for a given day
      await redisConnection.set(dedupKey, '1', 'EX', 93600);

      // Build notification text
      const whenText = daysLeft === 0
        ? '⚠️ <b>Сегодня срок</b>'
        : daysLeft === 1
          ? '📅 <b>Завтра срок</b>'
          : daysLeft < 0
            ? `⛔ <b>Просрочено на ${String(Math.abs(daysLeft))} дн.</b>`
            : `📅 <b>Напоминание: через ${String(daysLeft)} дн.</b>`;

      const emoji = TYPE_EMOJI[row.reminder_type] ?? '📌';
      let text = `${whenText}\n\n`;
      text += `${emoji} ${row.title}\n`;
      text += `💰 ${fmtAmt(row.amount)} ${row.currency}\n`;
      text += `📆 ${formatDate(row.due_date)}`;
      if (row.counterparty) text += `\n👤 ${row.counterparty}`;
      if (row.is_recurring && row.recurrence_pattern) {
        text += `\n${RECURRENCE_LABELS[row.recurrence_pattern] ?? '🔁'}`;
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Выполнено',  callback_data: `rem:done:${row.id}` },
            { text: '⏳ +1 день',   callback_data: `rem:snooze:${row.id}` },
          ],
          [{ text: '❌ Отменить', callback_data: `rem:cancel:${row.id}` }],
        ],
      };

      const alertId = ulid();
      await notificationsQueue.add(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          alertId,
          workspaceId: row.workspace_id,
          chatId: row.telegram_user_id,
          message: text,
          inlineKeyboardJson: JSON.stringify(keyboard),
          telegramUserId: row.telegram_user_id,
          isSuccessCard: true, // floating card — don't overwrite midas:am:
        },
        { jobId: IdempotencyKeyBuilder.notification(row.workspace_id, alertId) },
      );

      sent++;
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      console.error('[midas:cashflow-reminder-worker] Failed for reminder', {
        reminderId: row.id,
        workspaceId: row.workspace_id,
        errorClass,
      });
    }
  }

  console.log('[midas:cashflow-reminder-worker] Run complete', {
    jobId: job.id,
    sent,
    skipped,
    total: result.rows.length,
  });
}

// ─────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────

export function createCashflowReminderWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.CASHFLOW_REMINDER,
    processCashflowReminder,
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err: unknown) => {
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[midas:cashflow-reminder-worker] Job failed', {
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
  return num.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
