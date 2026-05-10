/**
 * Report Advanced Service — Phase 2.0 Sprint 4
 *
 * Provides rich report query functions for the Reports 2.0 screen.
 * All reports accept a date range [start, end) and return HTML-formatted strings.
 *
 * Design decisions:
 *   D1: All SQL via withTenantTransaction (SEC-03) with explicit workspace_id.
 *   D2: Amounts stay as NUMERIC strings — no Number()/parseFloat() (SEC-02).
 *       Exception: renderBar/renderTrend use parseFloat for display-only math.
 *   D3: All DB-sourced strings pass through escapeHtml before rendering.
 *   D4: Unicode bar charts use █ and ░ for Telegram-compatible rendering.
 *
 * SEC-12: Transaction amounts/descriptions are NOT logged.
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Format a DB NUMERIC string to 2 decimal places for display (SEC-02). */
function fmtAmt(numStr: string): string {
  const dotIdx = numStr.indexOf('.');
  if (dotIdx === -1) return `${numStr}.00`;
  const integer = numStr.slice(0, dotIdx);
  const frac = numStr.slice(dotIdx + 1).padEnd(2, '0').slice(0, 2);
  return `${integer}.${frac}`;
}

/** Render a Unicode bar chart segment. Display-only — parseFloat is safe here. */
function renderBar(value: number, max: number, width = 10): string {
  if (max <= 0) return '░'.repeat(width);
  const filled = Math.round((value / max) * width);
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(width - filled, 0));
}

/** Render a trend indicator: "+12.7% ↑" / "-6% ↓" / "0%". Display-only. */
function renderTrend(current: number, previous: number): string {
  if (previous === 0 && current === 0) return '0%';
  if (previous === 0) return '+∞ ↑';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct > 0 ? '+' : '';
  const arrow = pct > 0 ? ' ↑' : pct < 0 ? ' ↓' : '';
  return `${sign}${pct.toFixed(1)}%${arrow}`;
}

/** Russian month names (genitive) for date labels */
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

// ─────────────────────────────────────────────────────────────
// Summary Report
// ─────────────────────────────────────────────────────────────

interface SummaryRow {
  expense_total: string;
  income_total: string;
  expense_count: string;
  income_count: string;
  debt_count: string;
  total_count: string;
}

interface ExpensiveDayRow {
  day: string;
  total: string;
}

/**
 * Get a comprehensive summary report for the given period.
 */
export async function getReportSummary(
  workspaceId: string,
  userId: string,
  start: string,
  end: string,
  periodLabel: string,
): Promise<string> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const wRes = await client.query<{ default_currency: string }>(
      `SELECT default_currency FROM workspaces WHERE id = $1`, [workspaceId],
    );
    const cur = escapeHtml(wRes.rows[0]?.default_currency ?? 'USDT');

    const r = await client.query<SummaryRow>(
      `SELECT
         COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'expense'), 0)::text AS expense_total,
         COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'income'), 0)::text AS income_total,
         COUNT(*) FILTER (WHERE transaction_intent = 'expense')::text AS expense_count,
         COUNT(*) FILTER (WHERE transaction_intent = 'income')::text AS income_count,
         COUNT(*) FILTER (WHERE transaction_intent IN ('debt_given','debt_received'))::text AS debt_count,
         COUNT(*)::text AS total_count
       FROM transactions
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         AND transaction_time >= $2::timestamptz
         AND transaction_time < $3::timestamptz`,
      [workspaceId, start, end],
    );
    const row = r.rows[0];
    if (!row || row.total_count === '0') {
      return `📊 <b>Отчёт: ${escapeHtml(periodLabel)}</b>\n\nНет данных за выбранный период.`;
    }

    const expTotal = fmtAmt(row.expense_total);
    const incTotal = fmtAmt(row.income_total);
    // Balance = income - expense (display-only math, safe)
    const balance = (parseFloat(row.income_total) - parseFloat(row.expense_total)).toFixed(2);
    const balSign = parseFloat(balance) >= 0 ? '+' : '';

    // Most expensive day
    const dayR = await client.query<ExpensiveDayRow>(
      `SELECT transaction_time::date::text AS day,
              SUM(base_amount)::text AS total
       FROM transactions
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         AND transaction_intent = 'expense'
         AND transaction_time >= $2::timestamptz
         AND transaction_time < $3::timestamptz
       GROUP BY transaction_time::date
       ORDER BY SUM(base_amount) DESC
       LIMIT 1`,
      [workspaceId, start, end],
    );
    const expDay = dayR.rows[0];

    // Daily average
    const startD = new Date(start);
    const endD = new Date(end);
    const days = Math.max(1, Math.ceil((endD.getTime() - startD.getTime()) / 86_400_000));
    const avgExpense = (parseFloat(row.expense_total) / days).toFixed(2);

    let text = `📊 <b>Отчёт: ${escapeHtml(periodLabel)}</b>\n\n`;
    text += `💰 Доходы:       <b>${incTotal} ${cur}</b>\n`;
    text += `💸 Расходы:      <b>-${expTotal} ${cur}</b>\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📈 Баланс:       <b>${balSign}${fmtAmt(balance)} ${cur}</b>\n\n`;
    text += `📊 Всего операций: ${row.total_count}\n`;
    text += `     └ Расходов: ${row.expense_count} · Доходов: ${row.income_count} · Долгов: ${row.debt_count}\n`;

    if (expDay) {
      text += `\n📅 Самый дорогой день: ${fmtDate(expDay.day)} (${fmtAmt(expDay.total)} ${cur})`;
    }
    text += `\n📅 Средний расход/день: ${fmtAmt(avgExpense)} ${cur}/день`;

    return text;
  });
}

// ─────────────────────────────────────────────────────────────
// Category Breakdown
// ─────────────────────────────────────────────────────────────

interface CatRow {
  category_name: string;
  cat_total: string;
}

export async function getCategoryBreakdown(
  workspaceId: string,
  userId: string,
  start: string,
  end: string,
  periodLabel: string,
  intent: 'expense' | 'income' = 'expense',
): Promise<string> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const wRes = await client.query<{ default_currency: string }>(
      `SELECT default_currency FROM workspaces WHERE id = $1`, [workspaceId],
    );
    const cur = escapeHtml(wRes.rows[0]?.default_currency ?? 'USDT');

    const r = await client.query<CatRow>(
      `SELECT
         COALESCE(c.name, '—') AS category_name,
         SUM(t.base_amount)::text AS cat_total
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.workspace_id = $1
         AND t.deleted_at IS NULL
         AND t.transaction_intent = $4
         AND t.transaction_time >= $2::timestamptz
         AND t.transaction_time < $3::timestamptz
       GROUP BY c.name
       ORDER BY SUM(t.base_amount) DESC
       LIMIT 10`,
      [workspaceId, start, end, intent],
    );

    if (r.rows.length === 0) {
      return `📊 <b>Категории ${intent === 'expense' ? 'расходов' : 'доходов'} (${escapeHtml(periodLabel)})</b>\n\nНет данных.`;
    }

    const maxVal = parseFloat(r.rows[0]?.cat_total ?? '0');
    const total = r.rows.reduce((s, row) => s + parseFloat(row.cat_total), 0);

    let text = `📊 <b>TOP категории ${intent === 'expense' ? 'расходов' : 'доходов'} (${escapeHtml(periodLabel)}):</b>\n\n`;

    r.rows.forEach((row, i) => {
      const val = parseFloat(row.cat_total);
      const pct = total > 0 ? Math.round((val / total) * 100) : 0;
      const bar = renderBar(val, maxVal);
      const name = escapeHtml(row.category_name);
      const padded = name.length < 16 ? name + ' '.repeat(16 - name.length) : name;
      text += `${String(i + 1)}. ${padded} ${bar}  ${String(pct)}%  ${fmtAmt(row.cat_total)} ${cur}\n`;
    });

    return text;
  });
}

// ─────────────────────────────────────────────────────────────
// Expense / Income Only Reports
// ─────────────────────────────────────────────────────────────

interface DetailRow {
  item_name: string | null;
  category_name: string;
  base_amount: string;
  base_currency: string;
  transaction_time: string;
}

export async function getExpenseOnlyReport(
  workspaceId: string,
  userId: string,
  start: string,
  end: string,
  periodLabel: string,
): Promise<string> {
  return getIntentReport(workspaceId, userId, start, end, periodLabel, 'expense');
}

export async function getIncomeOnlyReport(
  workspaceId: string,
  userId: string,
  start: string,
  end: string,
  periodLabel: string,
): Promise<string> {
  return getIntentReport(workspaceId, userId, start, end, periodLabel, 'income');
}

async function getIntentReport(
  workspaceId: string,
  userId: string,
  start: string,
  end: string,
  periodLabel: string,
  intent: 'expense' | 'income',
): Promise<string> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const emoji = intent === 'expense' ? '💸' : '💰';
    const label = intent === 'expense' ? 'Расходы' : 'Доходы';

    const r = await client.query<DetailRow>(
      `SELECT
         t.item_name,
         COALESCE(c.name, '—') AS category_name,
         ROUND(t.base_amount, 2)::text AS base_amount,
         t.base_currency,
         t.transaction_time::text
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.workspace_id = $1
         AND t.deleted_at IS NULL
         AND t.transaction_intent = $4
         AND t.transaction_time >= $2::timestamptz
         AND t.transaction_time < $3::timestamptz
       ORDER BY t.transaction_time DESC
       LIMIT 30`,
      [workspaceId, start, end, intent],
    );

    if (r.rows.length === 0) {
      return `${emoji} <b>${label} (${escapeHtml(periodLabel)})</b>\n\nНет данных.`;
    }

    const totalR = await client.query<{ total: string; cnt: string }>(
      `SELECT SUM(base_amount)::text AS total, COUNT(*)::text AS cnt
       FROM transactions
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         AND transaction_intent = $4
         AND transaction_time >= $2::timestamptz
         AND transaction_time < $3::timestamptz`,
      [workspaceId, start, end, intent],
    );
    const totRow = totalR.rows[0];

    const cur = escapeHtml(r.rows[0]?.base_currency ?? 'USDT');
    let text = `${emoji} <b>${label}: ${escapeHtml(periodLabel)}</b>\n`;
    text += `Всего: <b>${fmtAmt(totRow?.total ?? '0')} ${cur}</b> (${totRow?.cnt ?? '0'} шт.)\n\n`;

    for (const row of r.rows) {
      const d = new Date(row.transaction_time);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const cat = escapeHtml(row.category_name);
      const item = row.item_name ? ` · ${escapeHtml(row.item_name)}` : '';
      text += `${dd}.${mm} ${cat}${item} — ${fmtAmt(row.base_amount)} ${escapeHtml(row.base_currency)}\n`;
    }

    return text;
  });
}

// ─────────────────────────────────────────────────────────────
// Comparison Report
// ─────────────────────────────────────────────────────────────

export async function getComparisonReport(
  workspaceId: string,
  userId: string,
  curStart: string,
  curEnd: string,
  periodLabel: string,
): Promise<string> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const wRes = await client.query<{ default_currency: string }>(
      `SELECT default_currency FROM workspaces WHERE id = $1`, [workspaceId],
    );
    const cur = escapeHtml(wRes.rows[0]?.default_currency ?? 'USDT');

    // Calculate previous period of same duration
    const startD = new Date(curStart);
    const endD = new Date(curEnd);
    const duration = endD.getTime() - startD.getTime();
    const prevStart = new Date(startD.getTime() - duration).toISOString();
    const prevEnd = curStart;

    // Current period stats
    const curR = await client.query<SummaryRow>(
      `SELECT
         COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'expense'), 0)::text AS expense_total,
         COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'income'), 0)::text AS income_total,
         COUNT(*) FILTER (WHERE transaction_intent = 'expense')::text AS expense_count,
         COUNT(*) FILTER (WHERE transaction_intent = 'income')::text AS income_count,
         COUNT(*) FILTER (WHERE transaction_intent IN ('debt_given','debt_received'))::text AS debt_count,
         COUNT(*)::text AS total_count
       FROM transactions
       WHERE workspace_id = $1 AND deleted_at IS NULL
         AND transaction_time >= $2::timestamptz AND transaction_time < $3::timestamptz`,
      [workspaceId, curStart, curEnd],
    );

    // Previous period stats
    const prevR = await client.query<SummaryRow>(
      `SELECT
         COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'expense'), 0)::text AS expense_total,
         COALESCE(SUM(base_amount) FILTER (WHERE transaction_intent = 'income'), 0)::text AS income_total,
         COUNT(*) FILTER (WHERE transaction_intent = 'expense')::text AS expense_count,
         COUNT(*) FILTER (WHERE transaction_intent = 'income')::text AS income_count,
         COUNT(*) FILTER (WHERE transaction_intent IN ('debt_given','debt_received'))::text AS debt_count,
         COUNT(*)::text AS total_count
       FROM transactions
       WHERE workspace_id = $1 AND deleted_at IS NULL
         AND transaction_time >= $2::timestamptz AND transaction_time < $3::timestamptz`,
      [workspaceId, prevStart, prevEnd],
    );

    const c = curR.rows[0];
    const p = prevR.rows[0];
    if (!c || !p) return `📈 <b>Сравнение</b>\n\nНет данных.`;

    const cInc = parseFloat(c.income_total);
    const pInc = parseFloat(p.income_total);
    const cExp = parseFloat(c.expense_total);
    const pExp = parseFloat(p.expense_total);
    const cBal = cInc - cExp;
    const pBal = pInc - pExp;

    let text = `📈 <b>Сравнение: ${escapeHtml(periodLabel)} vs предыдущий</b>\n\n`;
    text += `             Текущий      Прошлый      Δ\n`;
    text += `💰 Доходы   ${fmtAmt(c.income_total)} ${cur}   ${fmtAmt(p.income_total)} ${cur}   ${renderTrend(cInc, pInc)}\n`;
    text += `💸 Расходы  ${fmtAmt(c.expense_total)} ${cur}   ${fmtAmt(p.expense_total)} ${cur}   ${renderTrend(cExp, pExp)}\n`;
    text += `📈 Баланс   ${cBal >= 0 ? '+' : ''}${cBal.toFixed(2)} ${cur}   ${pBal >= 0 ? '+' : ''}${pBal.toFixed(2)} ${cur}   ${renderTrend(cBal, pBal)}\n`;

    // Category changes (top growers)
    interface CatCmp { category_name: string; cat_total: string }
    const curCats = await client.query<CatCmp>(
      `SELECT COALESCE(c.name,'—') AS category_name, SUM(t.base_amount)::text AS cat_total
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.workspace_id = $1 AND t.deleted_at IS NULL AND t.transaction_intent = 'expense'
         AND t.transaction_time >= $2::timestamptz AND t.transaction_time < $3::timestamptz
       GROUP BY c.name ORDER BY SUM(t.base_amount) DESC LIMIT 5`,
      [workspaceId, curStart, curEnd],
    );
    const prevCats = await client.query<CatCmp>(
      `SELECT COALESCE(c.name,'—') AS category_name, SUM(t.base_amount)::text AS cat_total
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.workspace_id = $1 AND t.deleted_at IS NULL AND t.transaction_intent = 'expense'
         AND t.transaction_time >= $2::timestamptz AND t.transaction_time < $3::timestamptz
       GROUP BY c.name ORDER BY SUM(t.base_amount) DESC LIMIT 5`,
      [workspaceId, prevStart, prevEnd],
    );

    const prevMap = new Map(prevCats.rows.map(r2 => [r2.category_name, parseFloat(r2.cat_total)]));

    if (curCats.rows.length > 0) {
      text += `\n📊 Категории с изменениями:\n`;
      for (const cat of curCats.rows) {
        const curVal = parseFloat(cat.cat_total);
        const prevVal = prevMap.get(cat.category_name) ?? 0;
        const diff = curVal - prevVal;
        if (Math.abs(diff) < 0.01) continue;
        const arrow = diff > 0 ? '⬆️' : '⬇️';
        const sign = diff > 0 ? '+' : '';
        text += `  ${arrow} ${escapeHtml(cat.category_name)}: ${sign}${diff.toFixed(0)} (${renderTrend(curVal, prevVal)})\n`;
      }
    }

    return text;
  });
}

// ─────────────────────────────────────────────────────────────
// Account Movements
// ─────────────────────────────────────────────────────────────

interface AccRow {
  account_name: string;
  total_in: string;
  total_out: string;
  tx_count: string;
}

export async function getAccountMovements(
  workspaceId: string,
  userId: string,
  start: string,
  end: string,
  periodLabel: string,
): Promise<string> {
  return await withTenantTransaction(workspaceId, userId, async (client) => {
    const wRes = await client.query<{ default_currency: string }>(
      `SELECT default_currency FROM workspaces WHERE id = $1`, [workspaceId],
    );
    const cur = escapeHtml(wRes.rows[0]?.default_currency ?? 'USDT');

    const r = await client.query<AccRow>(
      `SELECT
         COALESCE(a.name, '—') AS account_name,
         COALESCE(SUM(t.base_amount) FILTER (WHERE t.transaction_intent = 'income'), 0)::text AS total_in,
         COALESCE(SUM(t.base_amount) FILTER (WHERE t.transaction_intent = 'expense'), 0)::text AS total_out,
         COUNT(*)::text AS tx_count
       FROM transactions t
       LEFT JOIN account_sources a ON a.id = t.account_source_id
       WHERE t.workspace_id = $1
         AND t.deleted_at IS NULL
         AND t.transaction_time >= $2::timestamptz
         AND t.transaction_time < $3::timestamptz
       GROUP BY a.name
       ORDER BY COUNT(*) DESC`,
      [workspaceId, start, end],
    );

    if (r.rows.length === 0) {
      return `🏦 <b>По счетам (${escapeHtml(periodLabel)})</b>\n\nНет данных.`;
    }

    let text = `🏦 <b>Движение по счетам (${escapeHtml(periodLabel)})</b>\n\n`;

    for (const row of r.rows) {
      const name = escapeHtml(row.account_name);
      const inAmt = parseFloat(row.total_in);
      const outAmt = parseFloat(row.total_out);
      const net = inAmt - outAmt;
      text += `<b>${name}</b>\n`;
      text += `  💰 Приход: ${fmtAmt(row.total_in)} ${cur}\n`;
      text += `  💸 Расход: ${fmtAmt(row.total_out)} ${cur}\n`;
      text += `  📊 Итого: ${net >= 0 ? '+' : ''}${net.toFixed(2)} ${cur} (${row.tx_count} операций)\n\n`;
    }

    return text;
  });
}
