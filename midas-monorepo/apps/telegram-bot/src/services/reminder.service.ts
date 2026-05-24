/**
 * Reminder Service — Phase 7.1
 *
 * CRUD operations for financial_reminders (scheduled future financial events).
 * Provides:
 *   - CRUD: create, list, detail, complete, snooze, cancel, delete
 *   - Screen builders: list screen, detail screen, notification card
 *   - Date parser: parseRussianDate() for manual text input (no LLM needed)
 *
 * All SQL via withTenantTransaction (SEC-03).
 * Amounts stay as NUMERIC strings (SEC-02).
 */

import { withTenantTransaction } from '@midas/database';
import { ulid } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ReminderType = 'expense' | 'income' | 'debt_pay' | 'debt_receive';
export type ReminderStatus = 'active' | 'completed' | 'snoozed' | 'cancelled';
export type RecurrencePattern = 'weekly' | 'monthly' | 'yearly';

export interface FinancialReminder {
  id: string;
  workspaceId: string;
  title: string;
  amount: string;
  currency: string;
  reminderType: ReminderType;
  categoryId: string | null;
  counterparty: string | null;
  notes: string | null;
  dueDate: string;          // ISO date string: YYYY-MM-DD
  remindOffsets: number[];  // days before due date
  isRecurring: boolean;
  recurrencePattern: RecurrencePattern | null;
  status: ReminderStatus;
  snoozedUntil: string | null;
  lastRemindedAt: string | null;
  completedAt: string | null;
  linkedTxId: string | null;
  createdAt: string;
}

interface ReminderRow {
  id: string;
  workspace_id: string;
  title: string;
  amount: string;
  currency: string;
  reminder_type: string;
  category_id: string | null;
  counterparty: string | null;
  notes: string | null;
  due_date: string;
  remind_offsets: number[];
  is_recurring: boolean;
  recurrence_pattern: string | null;
  status: string;
  snoozed_until: string | null;
  last_reminded_at: string | null;
  completed_at: string | null;
  linked_tx_id: string | null;
  created_at: string;
}

export interface CreateReminderInput {
  title: string;
  amount: number;
  currency: string;
  reminderType: ReminderType;
  dueDate: string;            // YYYY-MM-DD
  categoryId?: string;
  counterparty?: string;
  notes?: string;
  remindOffsets?: number[];
  isRecurring?: boolean;
  recurrencePattern?: RecurrencePattern;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function mapRow(row: ReminderRow): FinancialReminder {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    amount: row.amount,
    currency: row.currency,
    reminderType: row.reminder_type as ReminderType,
    categoryId: row.category_id,
    counterparty: row.counterparty,
    notes: row.notes,
    dueDate: typeof row.due_date === 'string'
      ? row.due_date.slice(0, 10)
      : new Date(row.due_date).toISOString().slice(0, 10),
    remindOffsets: row.remind_offsets ?? [3, 1, 0],
    isRecurring: row.is_recurring,
    recurrencePattern: row.recurrence_pattern as RecurrencePattern | null,
    status: row.status as ReminderStatus,
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until).slice(0, 10) : null,
    lastRemindedAt: row.last_reminded_at,
    completedAt: row.completed_at,
    linkedTxId: row.linked_tx_id,
    createdAt: row.created_at,
  };
}

function formatAmount(val: string): string {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatDueDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const TYPE_LABELS: Record<ReminderType, string> = {
  expense: '💸 Расход',
  income: '💰 Доход',
  debt_pay: '🤝 Отдать долг',
  debt_receive: '🤲 Получить долг',
};

const TYPE_EMOJI: Record<ReminderType, string> = {
  expense: '💸',
  income: '💰',
  debt_pay: '🤝',
  debt_receive: '🤲',
};

const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  weekly: '🔁 Еженедельно',
  monthly: '🔁 Ежемесячно',
  yearly: '🔁 Ежегодно',
};

// ─────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────

/**
 * Get count of active reminders for a workspace (for hub label).
 */
export async function getReminderCount(
  workspaceId: string,
  userId: string,
): Promise<number> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM financial_reminders
       WHERE workspace_id = $1 AND status IN ('active','snoozed')`,
      [workspaceId],
    );
    return parseInt(r.rows[0]?.cnt ?? '0', 10);
  });
}

/**
 * Get all active/snoozed reminders for a workspace, ordered by due_date.
 */
export async function getReminders(
  workspaceId: string,
  userId: string,
): Promise<FinancialReminder[]> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<ReminderRow>(
      `SELECT * FROM financial_reminders
       WHERE workspace_id = $1 AND status IN ('active','snoozed')
       ORDER BY due_date ASC
       LIMIT 50`,
      [workspaceId],
    );
    return r.rows.map(mapRow);
  });
}

/**
 * Get a single reminder by ID.
 */
export async function getReminderDetail(
  workspaceId: string,
  userId: string,
  reminderId: string,
): Promise<FinancialReminder | null> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<ReminderRow>(
      `SELECT * FROM financial_reminders WHERE id = $1 AND workspace_id = $2`,
      [reminderId, workspaceId],
    );
    if (!r.rows[0]) return null;
    return mapRow(r.rows[0]);
  });
}

// ─────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────

/**
 * Create a new financial reminder.
 */
export async function createReminder(
  workspaceId: string,
  userId: string,
  input: CreateReminderInput,
): Promise<string> {
  const id = ulid();
  const offsets = input.remindOffsets ?? [3, 1, 0];
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `INSERT INTO financial_reminders
         (id, workspace_id, title, amount, currency, reminder_type,
          category_id, counterparty, notes, due_date, remind_offsets,
          is_recurring, recurrence_pattern)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id, workspaceId,
        input.title, input.amount, input.currency, input.reminderType,
        input.categoryId ?? null, input.counterparty ?? null, input.notes ?? null,
        input.dueDate, offsets,
        input.isRecurring ?? false, input.recurrencePattern ?? null,
      ],
    );
  });
  return id;
}

/**
 * Mark reminder as completed, optionally linking a transaction.
 */
export async function completeReminder(
  workspaceId: string,
  userId: string,
  reminderId: string,
  linkedTxId?: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `UPDATE financial_reminders
       SET status = 'completed', completed_at = NOW(), linked_tx_id = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3`,
      [linkedTxId ?? null, reminderId, workspaceId],
    );
  });
}

/**
 * Snooze a reminder by N days.
 */
export async function snoozeReminder(
  workspaceId: string,
  userId: string,
  reminderId: string,
  days: number = 1,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `UPDATE financial_reminders
       SET due_date = due_date + $1::integer * INTERVAL '1 day',
           status = 'active',
           updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3`,
      [days, reminderId, workspaceId],
    );
  });
}

/**
 * Cancel a reminder (soft-delete: status = 'cancelled').
 */
export async function cancelReminder(
  workspaceId: string,
  userId: string,
  reminderId: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `UPDATE financial_reminders
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2`,
      [reminderId, workspaceId],
    );
  });
}

/**
 * Hard-delete a reminder.
 */
export async function deleteReminder(
  workspaceId: string,
  userId: string,
  reminderId: string,
): Promise<void> {
  await withTenantTransaction(workspaceId, userId, async (client) => {
    await client.query(
      `DELETE FROM financial_reminders WHERE id = $1 AND workspace_id = $2`,
      [reminderId, workspaceId],
    );
  });
}

/**
 * Advance a recurring reminder to the next period.
 * Called after completing a recurring reminder.
 */
export async function advanceRecurring(
  workspaceId: string,
  userId: string,
  reminderId: string,
): Promise<string | null> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<{ recurrence_pattern: string; due_date: string }>(
      `SELECT recurrence_pattern, due_date FROM financial_reminders
       WHERE id = $1 AND workspace_id = $2 AND is_recurring = true`,
      [reminderId, workspaceId],
    );
    if (!r.rows[0]) return null;
    const pattern = r.rows[0].recurrence_pattern;
    const intervalMap: Record<string, string> = {
      weekly: '1 week',
      monthly: '1 month',
      yearly: '1 year',
    };
    const interval = intervalMap[pattern] ?? '1 month';
    const res = await client.query<{ new_date: string }>(
      `UPDATE financial_reminders
       SET due_date = due_date + INTERVAL '${interval}',
           status = 'active',
           completed_at = NULL,
           linked_tx_id = NULL,
           updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2
       RETURNING due_date::text AS new_date`,
      [reminderId, workspaceId],
    );
    return res.rows[0]?.new_date?.slice(0, 10) ?? null;
  });
}

// ─────────────────────────────────────────────────────────────
// Screen Builders
// ─────────────────────────────────────────────────────────────

/**
 * Build the reminder list screen (main hub entry point).
 */
export async function getReminderListScreen(
  workspaceId: string,
  userId: string,
): Promise<{ text: string; keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }> {
  const reminders = await getReminders(workspaceId, userId);

  if (reminders.length === 0) {
    return {
      text: '📅 <b>Напоминания</b>\n\nДобавьте будущие расходы, доходы или долги —\nбот напомнит за 3, 1 день и в сам день.\n\nПока нет ни одного напоминания.',
      keyboard: {
        inline_keyboard: [
          [{ text: '➕ Добавить напоминание', callback_data: 'rem:add' }],
          [{ text: '🔙 Назад', callback_data: 'st:ntf' }],
        ],
      },
    };
  }

  let text = '📅 <b>Напоминания</b>\n\nБот пришлёт уведомление за 3, 1 день и в срок.';
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const r of reminders) {
    const due = new Date(r.dueDate + 'T00:00:00');
    const daysLeft = Math.round((due.getTime() - today.getTime()) / 86400000);
    const daysText = daysLeft === 0 ? ' · сегодня ⚠️'
      : daysLeft === 1 ? ' · завтра'
      : daysLeft < 0 ? ` · просрочено ⛔`
      : ` · через ${String(daysLeft)} дн.`;
    const emoji = TYPE_EMOJI[r.reminderType];
    buttons.push([{
      text: `${emoji} ${r.title}  ${formatAmount(r.amount)} ${r.currency}${daysText}`,
      callback_data: `rem:v:${r.id}`,
    }]);
  }

  buttons.push([{ text: '➕ Добавить напоминание', callback_data: 'rem:add' }]);
  buttons.push([{ text: '🔙 Назад', callback_data: 'st:ntf' }]);

  return { text, keyboard: { inline_keyboard: buttons } };
}

/**
 * Build the reminder detail screen.
 */
export function buildReminderDetailScreen(
  r: FinancialReminder,
): { text: string; keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(r.dueDate + 'T00:00:00');
  const daysLeft = Math.round((due.getTime() - today.getTime()) / 86400000);
  const daysText = daysLeft === 0 ? 'сегодня ⚠️'
    : daysLeft === 1 ? 'завтра'
    : daysLeft < 0 ? `просрочено ${String(Math.abs(daysLeft))} дн. ⛔`
    : `через ${String(daysLeft)} дн.`;

  let text = `📅 <b>${r.title}</b>\n\n`;
  text += `${TYPE_LABELS[r.reminderType]}\n`;
  text += `💰 ${formatAmount(r.amount)} ${r.currency}\n`;
  text += `📆 Срок: ${formatDueDate(r.dueDate)} (${daysText})\n`;
  if (r.counterparty) text += `👤 ${r.counterparty}\n`;
  if (r.isRecurring && r.recurrencePattern) {
    text += `${RECURRENCE_LABELS[r.recurrencePattern]}\n`;
  }
  if (r.notes) text += `📝 ${r.notes}\n`;

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: '✅ Выполнено', callback_data: `rem:done:${r.id}` },
          { text: '⏳ +1 день', callback_data: `rem:snooze:${r.id}` },
        ],
        [
          { text: '✏️ Изменить', callback_data: `rem:edit:${r.id}` },
          { text: '🗑️ Удалить', callback_data: `rem:del:${r.id}` },
        ],
        [{ text: '🔙 К напоминаниям', callback_data: 'rem:list' }],
      ],
    },
  };
}

/**
 * Build an actionable push notification card (sent by CRON worker).
 */
export function buildReminderNotificationCard(
  r: FinancialReminder,
  daysLeft: number,
): { text: string; keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
  const whenText = daysLeft === 0 ? '⚠️ <b>Сегодня срок</b>'
    : daysLeft === 1 ? '📅 <b>Завтра срок</b>'
    : `📅 <b>Напоминание: через ${String(daysLeft)} дн.</b>`;

  let text = `${whenText}\n\n`;
  text += `${TYPE_EMOJI[r.reminderType]} ${r.title}\n`;
  text += `💰 ${formatAmount(r.amount)} ${r.currency}\n`;
  text += `📆 ${formatDueDate(r.dueDate)}`;
  if (r.counterparty) text += `\n👤 ${r.counterparty}`;
  if (r.isRecurring && r.recurrencePattern) {
    text += `\n${RECURRENCE_LABELS[r.recurrencePattern]}`;
  }

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: '✅ Выполнено', callback_data: `rem:done:${r.id}` },
          { text: '⏳ +1 день', callback_data: `rem:snooze:${r.id}` },
        ],
        [{ text: '❌ Отменить', callback_data: `rem:cancel:${r.id}` }],
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Date Parser (for manual text input — no LLM needed)
// ─────────────────────────────────────────────────────────────

const WEEKDAY_MAP: Record<string, number> = {
  'пон': 1, 'вторник': 2, 'вт': 2,
  'сред': 3, 'ср': 3,
  'четв': 4, 'чт': 4,
  'пятн': 5, 'пят': 5, 'пт': 5,
  'субб': 6, 'суб': 6, 'сб': 6,
  'воскрес': 0, 'вос': 0, 'вс': 0,
};

const MONTH_MAP: Record<string, number> = {
  'янв': 1, 'фев': 2, 'мар': 3, 'апр': 4,
  'май': 5, 'мая': 5, 'июн': 6, 'июл': 7,
  'авг': 8, 'сен': 9, 'окт': 10, 'ноя': 11, 'дек': 12,
};

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Parse a Russian natural-language date string into a YYYY-MM-DD ISO string.
 * Handles:
 *   - dd.mm.yyyy or dd.mm (exact date)
 *   - "через N дней/недель/месяцев"
 *   - "завтра", "послезавтра"
 *   - "N числа" (N-th of next/current month)
 *   - "в пятницу", "в следующий понедельник"
 *   - "15 июня", "1 января 2027"
 *
 * Returns null if parsing fails (caller shows error message).
 */
export function parseRussianDate(input: string, now: Date = new Date()): string | null {
  const text = input.trim().toLowerCase();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // 1. Exact date: dd.mm.yyyy or dd.mm
  const exactFull = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (exactFull) {
    const d = parseInt(exactFull[1]!, 10);
    const m = parseInt(exactFull[2]!, 10) - 1;
    const y = parseInt(exactFull[3]!, 10);
    const date = new Date(y, m, d);
    if (!isNaN(date.getTime())) return toIso(date);
  }
  const exactShort = text.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (exactShort) {
    const d = parseInt(exactShort[1]!, 10);
    const m = parseInt(exactShort[2]!, 10) - 1;
    const y = today.getFullYear();
    const candidate = new Date(y, m, d);
    if (candidate < today) candidate.setFullYear(y + 1);
    if (!isNaN(candidate.getTime())) return toIso(candidate);
  }

  // 2. "завтра" / "послезавтра"
  if (text.includes('послезавтра')) return toIso(addDays(today, 2));
  if (text.includes('завтра')) return toIso(addDays(today, 1));
  if (text === 'сегодня') return toIso(today);

  // 3. "через N дней/недель/месяцев"
  const relMatch = text.match(/через\s+(\d+)\s*(дн|день|дня|дней|недел|неделю|неделей|месяц|месяца|месяцев)/i);
  if (relMatch) {
    const n = parseInt(relMatch[1]!, 10);
    const unit = relMatch[2]!.toLowerCase();
    if (unit.startsWith('дн') || unit.startsWith('ден') || unit.startsWith('дей')) {
      return toIso(addDays(today, n));
    }
    if (unit.startsWith('недел')) {
      return toIso(addDays(today, n * 7));
    }
    if (unit.startsWith('месяц')) {
      const d = new Date(today);
      d.setMonth(d.getMonth() + n);
      return toIso(d);
    }
  }

  // 4. "N числа" — N-th day of current or next month
  const nthDay = text.match(/^(\d{1,2})\s*числа?$/i);
  if (nthDay) {
    const day = parseInt(nthDay[1]!, 10);
    if (day >= 1 && day <= 31) {
      const candidate = new Date(today.getFullYear(), today.getMonth(), day);
      if (candidate <= today) candidate.setMonth(candidate.getMonth() + 1);
      return toIso(candidate);
    }
  }

  // 5. "15 июня" or "15 июня 2027"
  const monthNameMatch = text.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
  if (monthNameMatch) {
    const day = parseInt(monthNameMatch[1]!, 10);
    const monthStr = monthNameMatch[2]!.slice(0, 3);
    const monthNum = MONTH_MAP[monthStr];
    if (monthNum !== undefined) {
      const year = monthNameMatch[3] ? parseInt(monthNameMatch[3], 10) : today.getFullYear();
      const candidate = new Date(year, monthNum - 1, day);
      if (candidate <= today && !monthNameMatch[3]) candidate.setFullYear(year + 1);
      if (!isNaN(candidate.getTime())) return toIso(candidate);
    }
  }

  // 6. "в пятницу" / "в следующий понедельник"
  const isNext = text.includes('следующ');
  for (const [key, targetDay] of Object.entries(WEEKDAY_MAP)) {
    if (text.includes(key)) {
      const current = today.getDay();
      let diff = targetDay - current;
      if (diff <= 0 || isNext) diff += 7;
      if (isNext && diff < 7) diff += 7;
      return toIso(addDays(today, diff));
    }
  }

  return null;
}

/**
 * Format a parsed amount+currency string like "15000 UAH" → { amount: 15000, currency: 'UAH' }.
 * Returns null if parsing fails.
 */
export function parseAmountCurrency(
  input: string,
  defaultCurrency: string = 'UAH',
): { amount: number; currency: string } | null {
  const text = input.trim();
  // Match: number (optional spaces) optional-currency
  const m = text.match(/^([\d\s.,]+)\s*([A-Za-zА-Яа-яёЁ$€£₴₽]*)?$/);
  if (!m) return null;

  const rawNum = m[1]!.replace(/\s/g, '').replace(',', '.');
  const amount = parseFloat(rawNum);
  if (isNaN(amount) || amount <= 0) return null;

  let currency = (m[2] ?? '').trim().toUpperCase();
  // Minimal currency normalization
  const currencyMap: Record<string, string> = {
    'РУБ': 'RUB', 'РУБ.': 'RUB', '₽': 'RUB',
    'ГРН': 'UAH', 'ГРИ': 'UAH', '₴': 'UAH',
    '$': 'USD', 'БАК': 'USD', 'ДОЛЛ': 'USD',
    '€': 'EUR', 'ЕВР': 'EUR',
    'Ф': 'GBP', '£': 'GBP',
  };
  currency = currencyMap[currency] ?? (currency.length >= 3 && currency.length <= 6 ? currency : defaultCurrency);

  return { amount, currency };
}
