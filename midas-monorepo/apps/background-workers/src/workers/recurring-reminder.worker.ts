/**
 * Recurring Reminder Worker — Phase 7.0-C
 *
 * CRON: every hour at minute 0 (0 * * * *)
 *
 * Flow:
 *  1. SELECT recurring_transactions WHERE next_fire_date <= CURRENT_DATE AND is_active = true
 *  2. For each due subscription, send a reminder notification card
 *  3. Reminder card has: ✅ Записать | ⏭ Пропустить | ✖️ Отменить подписку
 *  4. User action is handled by sub:fire/sub:skip/sub:cancel callback handlers
 *
 * SEC-03: pool.query for discovery (no RLS needed — we query all workspaces),
 *         withTenantTransaction for writes.
 * SEC-12: No raw amounts in logs.
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, IdempotencyKeyBuilder } from '@midas/shared';
import { redisConnection } from '../queues/redis.js';
import { recurringReminderQueue as _recurringReminderQueue, notificationsQueue } from '../queues/queue-definitions.js';
import { pool } from '@midas/database';
import { ulid } from 'ulid';

export const RECURRING_CRON_PATTERN = '0 * * * *'; // every hour at :00
export const RECURRING_CRON_JOB_ID = 'system|recurring-reminder|cron';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface RecurringDueRow {
  id: string;
  workspace_id: string;
  telegram_user_id: string;
  amount: string;
  currency: string;
  item_name: string | null;
  category_name: string | null;
  category_icon: string | null;
  frequency: string;
  next_fire_date: string;
}

const FREQ_LABELS: Record<string, string> = {
  daily: 'ежедневно',
  weekly: 'еженедельно',
  monthly: 'ежемесячно',
  yearly: 'ежегодно',
};

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processRecurringReminder(job: Job): Promise<void> {
  console.log('[midas:recurring-reminder-worker] Run started', { jobId: job.id });

  // Find all due recurring transactions across all workspaces
  const result = await pool.query<RecurringDueRow>(`
    SELECT
      rt.id, rt.workspace_id,
      u.telegram_id AS telegram_user_id,
      rt.amount::text, rt.currency,
      rt.item_name, rt.frequency,
      rt.next_fire_date::text,
      COALESCE(c.name, '') AS category_name,
      COALESCE(c.icon, '📁') AS category_icon
    FROM recurring_transactions rt
    JOIN workspaces w ON w.id = rt.workspace_id
    JOIN users u ON u.workspace_id = rt.workspace_id
    LEFT JOIN categories c ON c.id = rt.category_id
    WHERE rt.is_active = true
      AND rt.next_fire_date <= CURRENT_DATE
  `);

  console.log('[midas:recurring-reminder-worker] Due subscriptions found', {
    count: result.rows.length,
  });

  for (const row of result.rows) {
    try {
      // Dedup: only send one reminder per recurring_id per fire_date
      const dedupKey = `midas:rec:reminded:${row.id}:${row.next_fire_date}`;
      const alreadySent = await redisConnection.get(dedupKey);
      if (alreadySent) continue;

      // Mark as reminded (TTL 48h)
      await redisConnection.set(dedupKey, '1', 'EX', 172800);

      const name = row.item_name ?? row.category_name ?? '—';
      const icon = row.category_icon ?? '📁';
      const freqLabel = FREQ_LABELS[row.frequency] ?? row.frequency;
      const dateStr = formatDate(row.next_fire_date);

      let text = `🔄 <b>Напоминание о платеже</b>\n\n`;
      text += `${icon} ${name} · ${fmtAmt(row.amount)} ${row.currency}\n`;
      text += `📅 ${freqLabel}\n`;
      text += `📆 Следующий: ${dateStr}`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ Записать', callback_data: `sub:fire:${row.id}` }],
          [{ text: '⏭ Пропустить', callback_data: `sub:skip:${row.id}` }],
          [{ text: '✖️ Отменить подписку', callback_data: `sub:cancel:${row.id}` }],
        ],
      };

      const alertId = ulid();
      await notificationsQueue.add(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          alertId,
          workspaceId: row.workspace_id,
          chatId: row.telegram_user_id, // private chat = same as user ID
          message: text,
          inlineKeyboardJson: JSON.stringify(keyboard),
          telegramUserId: row.telegram_user_id,
          isSuccessCard: true, // floating card — don't update midas:am:
        },
        { jobId: IdempotencyKeyBuilder.notification(row.workspace_id, alertId) },
      );

      console.log('[midas:recurring-reminder-worker] Reminder sent', {
        recurringId: row.id,
        workspaceId: row.workspace_id,
        nextFireDate: row.next_fire_date,
      });
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      console.error('[midas:recurring-reminder-worker] Failed for recurring', {
        recurringId: row.id,
        workspaceId: row.workspace_id,
        errorClass,
      });
    }
  }

  console.log('[midas:recurring-reminder-worker] Run complete', { jobId: job.id });
}

// ─────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────

export function createRecurringReminderWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAMES.RECURRING_REMINDER,
    processRecurringReminder,
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err: unknown) => {
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[midas:recurring-reminder-worker] Job failed', {
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
  const d = new Date(dateStr);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear())}`;
}
