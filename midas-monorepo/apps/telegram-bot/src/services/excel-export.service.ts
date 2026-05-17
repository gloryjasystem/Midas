/**
 * Excel Export Service — Phase 2.x
 *
 * Generates a professional .xlsx file with all workspace transactions.
 * Uses exceljs for full styling support (colors, fonts, freeze panes, formulas).
 *
 * Sheet 1 — «Транзакции»   : full transaction log, 16 columns
 * Sheet 2 — «Счета»        : per-account summary
 * Sheet 3 — «Категории»    : per-category summary
 * Sheet 4 — «По месяцам»   : monthly dynamics
 *
 * Design rules:
 *   SEC-02: amounts kept as numeric, no float rounding issues.
 *   All DB strings treated as untrusted input — no HTML escaping needed for Excel.
 */

import ExcelJS from 'exceljs';
import { withTenantTransaction } from '@midas/database';

// ─────────────────────────────────────────────────────────────
// Brand colours
// ─────────────────────────────────────────────────────────────

const C_HEADER_BG   = '1A3C5E'; // deep navy — sheet header
const C_COL_HDR_BG  = '2D6A9F'; // mid-blue — column header row
const C_COL_HDR_FG  = 'FFFFFF';
const C_ROW_ODD     = 'F4F8FC';
const C_TOTAL_BG    = 'FFF3CD'; // amber — totals row
const C_EXPENSE     = 'C0392B'; // red
const C_INCOME      = '27AE60'; // green
const C_DEBT_GIVE   = '2980B9'; // blue
const C_DEBT_RECV   = 'E67E22'; // orange
const C_GREY_BG     = 'F2F2F2'; // summary block bg

// ─────────────────────────────────────────────────────────────
// Intent localisation
// ─────────────────────────────────────────────────────────────

function localiseIntent(intent: string): string {
  switch (intent) {
    case 'expense':       return '💸 Расход';
    case 'income':        return '💰 Доход';
    case 'transfer':      return '🔄 Перевод';
    case 'debt_given':    return '🤝 Долг (дал)';
    case 'debt_received': return '🤲 Долг (взял)';
    default:              return intent;
  }
}

function intentColour(intent: string): string {
  switch (intent) {
    case 'expense':       return C_EXPENSE;
    case 'income':        return C_INCOME;
    case 'transfer':      return '9B59B6'; // purple
    case 'debt_given':    return C_DEBT_GIVE;
    case 'debt_received': return C_DEBT_RECV;
    default:              return '555555';
  }
}

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear())}`;
}

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtMon(d: Date): string {
  const months = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return `${months[d.getMonth()] ?? ''} ${String(d.getFullYear())}`;
}

/** Signed amount for summary cells: "+ 10 000.00" | "− 1 000.00" | "—" */
function fmtAmtSigned(val: number): string {
  if (val === 0) return '—';
  const abs = Math.abs(val).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return val > 0 ? `+ ${abs}` : `\u2212 ${abs}`;
}

/** Russian plural for операция */
function countStr(n: number): string {
  const a = Math.abs(n);
  if (a % 10 === 1 && a % 100 !== 11) return `${String(n)} операция`;
  if ([2, 3, 4].includes(a % 10) && ![12, 13, 14].includes(a % 100)) return `${String(n)} операции`;
  return `${String(n)} операций`;
}

// ─────────────────────────────────────────────────────────────
// DB row types
// ─────────────────────────────────────────────────────────────

interface TxRow {
  transaction_time: Date;
  transaction_intent: string;
  original_amount: string;
  currency: string;
  account_debit_amount: string | null;
  account_debit_currency: string | null;
  exchange_rate: string;
  category_name: string;
  category_group: string;
  account_name: string;
  account_currency: string;
  account_type: string;
  item_name: string | null;
  person_name: string | null;
  balance_after: string; // running balance on the account after this transaction
}

// ─────────────────────────────────────────────────────────────
// Main export function
// ─────────────────────────────────────────────────────────────

/**
 * Generate Excel workbook buffer for all transactions in a workspace.
 *
 * @param workspaceId  - tenant workspace ULID
 * @param userId       - user ULID (for RLS via withTenantTransaction)
 * @param dateFrom     - inclusive start (defaults to epoch)
 * @param dateTo       - inclusive end (defaults to now)
 * @returns Buffer containing .xlsx file bytes
 */
export async function exportTransactionsExcel(
  workspaceId: string,
  userId: string,
  dateFrom?: Date,
  dateTo?: Date,
  accountId?: string,
): Promise<Buffer> {
  const from = dateFrom ?? new Date(0);
  const to   = dateTo   ?? new Date();

  const rows = await withTenantTransaction(workspaceId, userId, async (client) => {
    const accFilter = accountId ? `AND t.account_id = $4` : '';
    const params: (string | Date)[] = [workspaceId, from.toISOString(), to.toISOString()];
    if (accountId) params.push(accountId);

    const r = await client.query<TxRow>(
      `WITH all_tx AS (
         SELECT
           t.id,
           t.workspace_id,
           t.transaction_time,
           t.created_at,
           t.transaction_intent,
           t.original_amount,
           t.currency,
           t.account_debit_amount,
           t.account_debit_currency,
           COALESCE(t.exchange_rate, 1)  AS exchange_rate,
           t.account_id,
           t.category_id,
           t.item_name,
           t.person_id,
           t.deleted_at,
           CASE
             WHEN t.transaction_intent IN ('income', 'debt_received')
               THEN  COALESCE(t.account_debit_amount, t.original_amount)
             ELSE   -COALESCE(t.account_debit_amount, t.original_amount)
           END AS signed_debit
         FROM transactions t
         WHERE t.workspace_id = $1 AND t.deleted_at IS NULL ${accFilter}
       ),
       with_balance AS (
         SELECT
           tx.*,
           a.initial_balance + SUM(tx.signed_debit) OVER (
             PARTITION BY tx.account_id
             ORDER BY tx.transaction_time, tx.created_at
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS balance_after
         FROM all_tx tx
         JOIN account_sources a ON a.id = tx.account_id
       )
       SELECT
         wb.transaction_time,
         wb.transaction_intent,
         wb.original_amount::text,
         wb.currency,
         wb.account_debit_amount::text,
         wb.account_debit_currency,
         wb.exchange_rate::text,
         COALESCE(c.name, '—')        AS category_name,
         COALESCE(c.group::text, '—') AS category_group,
         COALESCE(a.name, '—')        AS account_name,
         COALESCE(a.currency, '—')    AS account_currency,
         COALESCE(a.type::text, '—')  AS account_type,
         wb.item_name,
         p.canonical_name             AS person_name,
         ROUND(wb.balance_after, 2)::text AS balance_after
       FROM with_balance wb
       LEFT JOIN categories    c ON c.id = wb.category_id
       LEFT JOIN account_sources a ON a.id = wb.account_id
       LEFT JOIN persons        p ON p.id = wb.person_id
       WHERE wb.transaction_time >= $2
         AND wb.transaction_time <= $3
       ORDER BY wb.transaction_time DESC`,
      params,
    );
    return r.rows;
  });


  const wb = new ExcelJS.Workbook();
  wb.creator = 'Midas Finance Bot';
  wb.created = new Date();

  buildSheet0Summary(wb, rows, from, to);
  buildSheet1(wb, rows, from, to);
  buildSheet2(wb, rows);
  buildSheet3(wb, rows);
  buildSheet4(wb, rows);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ─────────────────────────────────────────────────────────────
// Helper: set column header cell
// ─────────────────────────────────────────────────────────────

function hdr(ws: ExcelJS.Worksheet, col: number, row: number, text: string, width: number): void {
  const cell = ws.getCell(row, col);
  cell.value = text;
  cell.font = { bold: true, color: { argb: `FF${C_COL_HDR_FG}` }, size: 9, name: 'Calibri' };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_COL_HDR_BG}` } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = {
    bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
    right:  { style: 'thin', color: { argb: 'FFAAAAAA' } },
  };
  ws.getColumn(col).width = width;
}

// ─────────────────────────────────────────────────────────────
// Sheet 0: Сводка — FIRST SHEET (Tasks 0.3 + 0.6)
// ─────────────────────────────────────────────────────────────

function buildSheet0Summary(wb: ExcelJS.Workbook, rows: TxRow[], from: Date, to: Date): void {
  const ws = wb.addWorksheet('Сводка');
  const periodStr = `${fmtDate(from)} — ${fmtDate(to)}`;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 18;

  let r = 1;

  const mergeFill = (fromRow: number, fromCol: number, toRow: number, toCol: number, bg: string) => {
    ws.mergeCells(fromRow, fromCol, toRow, toCol);
    const c = ws.getCell(fromRow, fromCol);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bg}` } };
    return c;
  };

  const cell = (row: number, col: number, val: string | number, bold = false, color?: string, numFmt?: string) => {
    const c = ws.getCell(row, col);
    c.value = val;
    c.font = { size: 9, name: 'Calibri', bold, color: color ? { argb: color } : undefined };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    c.alignment = { vertical: 'middle', horizontal: typeof val === 'number' ? 'right' : 'left' };
    if (numFmt) c.numFmt = numFmt;
    return c;
  };

  const sectionHdr = (title: string) => {
    mergeFill(r, 1, r, 5, C_COL_HDR_BG);
    const c = ws.getCell(r, 1);
    c.value = title;
    c.font = { bold: true, size: 9, color: { argb: `FF${C_COL_HDR_FG}` }, name: 'Calibri' };
    ws.getRow(r).height = 18;
    r++;
  };

  // ── Title ──────────────────────────────────────────────────
  const title = mergeFill(r, 1, r, 5, C_HEADER_BG);
  title.value = 'MIDAS — Финансовый отчёт';
  title.font = { bold: true, size: 14, color: { argb: `FF${C_COL_HDR_FG}` }, name: 'Calibri' };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 30;
  r++;

  cell(r, 1, 'Период:', true); cell(r, 2, `${periodStr} (${String(days)} дн.)`); r++;
  cell(r, 1, 'Сформирован:', true); cell(r, 2, `${fmtDate(new Date())} ${fmtTime(new Date())}`); r++;
  r++; // spacer

  // ── СВОДКА ЗА ПЕРИОД ──────────────────────────────────────
  sectionHdr('СВОДКА ЗА ПЕРИОД');

  type ITotals = { count: number; total: number };
  type IntentKey = 'income' | 'expense' | 'transfer' | 'debt_given' | 'debt_received';
  const im: Record<IntentKey, ITotals> = {
    income:        { count: 0, total: 0 },
    expense:       { count: 0, total: 0 },
    transfer:      { count: 0, total: 0 },
    debt_given:    { count: 0, total: 0 },
    debt_received: { count: 0, total: 0 },
  };
  for (const row of rows) {
    const key = row.transaction_intent as IntentKey;
    if (key in im) { im[key].count++; im[key].total += parseFloat(row.original_amount); }
  }

  const intentRows: [string, string, number, boolean][] = [
    ['💰 Доходы',        countStr(im.income.count),        im.income.total,       false],
    ['💸 Расходы',       countStr(im.expense.count),       -im.expense.total,     false],
    ['🔄 Переводы',      countStr(im.transfer.count),      im.transfer.total,     false],
    ['🤝 Долги (дал)',   countStr(im.debt_given.count),    -im.debt_given.total,  false],
    ['🤲 Долги (взял)',  countStr(im.debt_received.count), im.debt_received.total, false],
  ];
  for (const [label, cnt, amt] of intentRows) {
    cell(r, 1, label); cell(r, 2, cnt); cell(r, 3, fmtAmtSigned(amt));
    r++;
  }
  const netTotal = im.income.total + im.debt_received.total - im.expense.total - im.transfer.total - im.debt_given.total;
  const totalC = cell(r, 1, 'Итог за период', true, undefined);
  totalC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_BG}` } };
  const netCell = cell(r, 3, fmtAmtSigned(netTotal), true, netTotal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`);
  netCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_BG}` } };
  r++; r++; // spacer

  // ── ОСТАТКИ ПО СЧЕТАМ ────────────────────────────────────
  sectionHdr('ОСТАТКИ ПО СЧЕТАМ');
  // Column sub-headers
  ['Счёт', 'Валюта', 'Нач. периода', 'Кон. периода', 'Изменение'].forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true, size: 8, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    c.alignment = { horizontal: i > 1 ? 'right' : 'left' };
  });
  r++;

  // Per-account: rows are DESC sorted, first occurrence = most recent = end balance
  type AccSumm = { currency: string; endBal: number; netChange: number };
  const accMap = new Map<string, AccSumm>();
  for (const row of rows) {
    const k = row.account_name;
    if (!accMap.has(k)) {
      accMap.set(k, { currency: row.account_currency, endBal: parseFloat(row.balance_after), netChange: 0 });
    }
    const acc = accMap.get(k)!;
    const debitAbs = parseFloat(row.account_debit_amount ?? row.original_amount);
    const isInflow = row.transaction_intent === 'income' || row.transaction_intent === 'debt_received';
    acc.netChange += isInflow ? debitAbs : -debitAbs;
  }
  for (const [name, acc] of accMap) {
    const startBal = acc.endBal - acc.netChange;
    cell(r, 1, name); cell(r, 2, acc.currency);
    cell(r, 3, fmtAmtSigned(startBal)); cell(r, 4, fmtAmtSigned(acc.endBal));
    const chg = acc.endBal - startBal;
    cell(r, 5, fmtAmtSigned(chg), false, chg >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`);
    r++;
  }
  r++; // spacer

  // ── СВОДКА ПО ВАЛЮТАМ ─────────────────────────────────────
  sectionHdr('СВОДКА ПО ВАЛЮТАМ');
  ['Валюта', 'Операций', 'Доходы', 'Расходы', 'Итог'].forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true, size: 8, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
  });
  r++;

  type CurTotals2 = { count: number; income: number; expense: number };
  const byCur = new Map<string, CurTotals2>();
  for (const row of rows) {
    const cur = row.currency;
    const t = byCur.get(cur) ?? { count: 0, income: 0, expense: 0 };
    t.count++;
    if (row.transaction_intent === 'income')  t.income  += parseFloat(row.original_amount);
    if (row.transaction_intent === 'expense') t.expense += parseFloat(row.original_amount);
    byCur.set(cur, t);
  }
  for (const [cur, t] of byCur) {
    const net = t.income - t.expense;
    cell(r, 1, cur); cell(r, 2, String(t.count));
    cell(r, 3, fmtAmtSigned(t.income)); cell(r, 4, fmtAmtSigned(-t.expense));
    cell(r, 5, fmtAmtSigned(net), false, net >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`);
    r++;
  }
  r++; // spacer

  // ── ТОП КАТЕГОРИЙ РАСХОДОВ ────────────────────────────────
  sectionHdr('ТОП КАТЕГОРИЙ РАСХОДОВ');
  const catMap = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    if (row.transaction_intent !== 'expense') continue;
    const k = row.category_name;
    const c = catMap.get(k) ?? { total: 0, count: 0 };
    c.total += parseFloat(row.original_amount); c.count++;
    catMap.set(k, c);
  }
  const totalExpense = im.expense.total || 1;
  const topCats = [...catMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  if (topCats.length === 0) { cell(r, 1, '—'); r++; }
  for (const [i, [name, c]] of topCats.entries()) {
    const pct = Math.round((c.total / totalExpense) * 100);
    cell(r, 1, `${String(i + 1)}.  ${name}`);
    cell(r, 2, countStr(c.count));
    cell(r, 3, fmtAmtSigned(-c.total));
    cell(r, 4, `${String(pct)}%`);
    r++;
  }
  r++; r++; // spacer before footer

  // ── Audit Trail Footer (Task 0.6) ─────────────────────────
  const footerStyle = (row: number) => {
    ws.mergeCells(row, 1, row, 5);
    const c = ws.getCell(row, 1);
    c.font = { size: 8, italic: true, color: { argb: 'FF888888' }, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
    return c;
  };
  footerStyle(r).value = '─────────────────────────────────────────────────────────'; r++;
  footerStyle(r).value = 'Документ сформирован системой MIDAS v2.0'; r++;
  footerStyle(r).value = `Дата экспорта: ${fmtDate(new Date())} ${fmtTime(new Date())}`; r++;
  footerStyle(r).value = `Период: ${periodStr}`; r++;
  footerStyle(r).value = `Количество записей: ${String(rows.length)}`; r++;
  footerStyle(r).value = '─────────────────────────────────────────────────────────'; r++;
  footerStyle(r).value = 'Документ является информационным. Для официального подтверждения операций обратитесь в банк или платёжную систему.'; r++;

  ws.views = [{ state: 'normal', activeCell: 'A1' }];
}

// ─────────────────────────────────────────────────────────────
// Sheet 1: Транзакции
// ─────────────────────────────────────────────────────────────

function buildSheet1(wb: ExcelJS.Workbook, rows: TxRow[], from: Date, to: Date): void {
  const ws = wb.addWorksheet('Транзакции');

  // ── Row 1: Title banner ──────────────────────────────────────
  ws.mergeCells('A1:P1');
  const titleCell = ws.getCell('A1');
  const periodStr = `${fmtDate(from)} — ${fmtDate(to)}`;
  titleCell.value = `MIDAS · Финансовый отчёт · ${periodStr}`;
  titleCell.font = { bold: true, color: { argb: `FF${C_COL_HDR_FG}` }, size: 14, name: 'Calibri' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 36;

  // ── Summary block (rows 2–9, cols L–N): grouped BY CURRENCY ──
  // Never add PLN + UAH + USD together — that's meaningless.
  type CurTotals = { income: number; expense: number; transfer: number; debtGive: number; debtRecv: number };
  const byCur = new Map<string, CurTotals>();
  for (const r of rows) {
    const cur = r.currency;
    const amt = parseFloat(r.original_amount);
    const t   = byCur.get(cur) ?? { income: 0, expense: 0, transfer: 0, debtGive: 0, debtRecv: 0 };
    if (r.transaction_intent === 'income')        t.income   += amt;
    if (r.transaction_intent === 'expense')       t.expense  += amt;
    if (r.transaction_intent === 'transfer')      t.transfer += amt;
    if (r.transaction_intent === 'debt_given')    t.debtGive += amt;
    if (r.transaction_intent === 'debt_received') t.debtRecv += amt;
    byCur.set(cur, t);
  }

  // Header row 2
  const summHdrCell = ws.getCell(2, 12);
  summHdrCell.value = `Сводка по валютам · ${rows.length} операций`;
  summHdrCell.font = { bold: true, size: 9, name: 'Calibri', color: { argb: `FF${C_COL_HDR_FG}` } };
  summHdrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  summHdrCell.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 12, 2, 14);

  // Rows 3–9: fill per currency (max 7 rows available before row 10 header)
  let summRow = 3;
  for (const [cur, t] of byCur) {
    if (summRow > 9) break;
    const net = t.income + t.debtRecv - t.expense - t.transfer - t.debtGive;
    // One compact line per currency: "USD  +10000 / -5000 = +5000"
    const lc = ws.getCell(summRow, 12);
    lc.value = `${cur}  💰${t.income.toFixed(0)}  💸${t.expense.toFixed(0)}  🔄${t.transfer.toFixed(0)}`;
    lc.font  = { size: 8, name: 'Calibri' };
    lc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    lc.alignment = { horizontal: 'left' };

    const vc = ws.getCell(summRow, 13);
    vc.value  = parseFloat(net.toFixed(2));
    vc.numFmt = '+#,##0.00;-#,##0.00';
    vc.font   = { bold: true, size: 8, name: 'Calibri',
      color: { argb: net >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
    vc.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    vc.alignment = { horizontal: 'right' };

    const cc = ws.getCell(summRow, 14);
    cc.value = cur;
    cc.font  = { italic: true, size: 8, name: 'Calibri', color: { argb: 'FF888888' } };
    cc.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    summRow++;
  }

  // ── Row 9: Empty spacer ──────────────────────────────────────
  ws.getRow(9).height = 6;




  // ── Row 10: Column headers ───────────────────────────────────
  const HDR_ROW = 10;
  ws.getRow(HDR_ROW).height = 36;

  const cols: Array<[string, number]> = [
    ['№',                  5],
    ['Дата',              12],
    ['Время',              8],
    ['Тип',               16],
    ['Исполнитель',       18],
    ['Счёт',              18],
    ['Вал.\nсчёта',        8],
    ['Сумма',             14],
    ['Вал.\nсуммы',        8],
    ['Выплачено',         14],
    ['Вал.\nвыплаты',      8],
    ['Курс',              10],
    ['Категория',         16],
    ['Группа',            12],
    ['Комментарий',       25],
    ['Остаток\nна счету', 14],  // col 16 — running balance
    ['Часов\n(вручную)', 13],  // col 17
    ['Ставка/час\n(авто)', 13],  // col 18
  ];
  cols.forEach(([text, width], i) => hdr(ws, i + 1, HDR_ROW, text, width));

  // Col 16 «Остаток» header: use a distinct background to set it apart
  ws.getCell(HDR_ROW, 16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5276' } };
  // Col 17 «Часов» header: light-yellow tint
  ws.getCell(HDR_ROW, 17).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7D6608' } };

  // ── Rows 11+: Data ───────────────────────────────────────────
  const DATA_START = 11;

  rows.forEach((row, idx) => {
    const rNum = DATA_START + idx;
    const wsRow = ws.getRow(rNum);
    wsRow.height = 18;

    const isOdd = idx % 2 === 0;
    const bgColor = isOdd ? 'FFFFFFFF' : `FF${C_ROW_ODD}`;

    const txDate   = new Date(row.transaction_time);
    const amtNum   = parseFloat(row.original_amount);
    const rateNum  = parseFloat(row.exchange_rate ?? '1');
    const colour   = intentColour(row.transaction_intent);

    // «Выплачено» = фактическое движение по счёту:
    //   income / debt_received → положительное (зачисление)
    //   expense / transfer / debt_given → отрицательное (списание)
    const debitRaw = row.account_debit_amount;
    const debitAbs = parseFloat(debitRaw ?? row.original_amount);
    const debitCur = row.account_debit_currency ?? row.currency;
    const isInflow = row.transaction_intent === 'income' || row.transaction_intent === 'debt_received';
    const debitSigned = isInflow ? debitAbs : -debitAbs;

    // «Исполнитель»: person_name из БД, иначе эвристика из item_name
    let executor = row.person_name ?? '';
    if (!executor && row.item_name) {
      const words = row.item_name.trim().split(/\s+/);
      const lastCapital = words.reverse().find(w => w.length > 2 && /^[А-ЯA-Z]/.test(w));
      executor = lastCapital ?? '';
    }

    const cellValues: (string | number | null)[] = [
      idx + 1,
      fmtDate(txDate),
      fmtTime(txDate),
      localiseIntent(row.transaction_intent),
      executor || '—',
      row.account_name,
      row.account_currency,
      amtNum,
      row.currency,
      debitSigned,    // col J: Выплачено — ВСЕГДА, со знаком
      debitCur,       // col K: Вал. выплаты — ВСЕГДА
      rateNum,        // col L: Курс
      row.category_name,
      row.category_group,
      row.item_name ?? '',
      parseFloat(row.balance_after), // col P: Остаток на счету
    ];

    cellValues.forEach((val, ci) => {
      const cell = ws.getCell(rNum, ci + 1);
      cell.value = val;
      cell.font = { size: 9, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle' };

      // Colour type (col D=4) and amount (col H=8)
      if (ci === 3 || ci === 7) {
        cell.font = { size: 9, name: 'Calibri', color: { argb: `FF${colour}` }, bold: ci === 3 };
      }
      // Number format for amounts
      if (ci === 7) cell.numFmt = '#,##0.00';
      // col J (ci=9): Выплачено — signed, colour by sign
      if (ci === 9) {
        const sv = val as number;
        cell.numFmt = '#,##0.00';
        cell.font = { size: 9, name: 'Calibri',
          color: { argb: sv >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
      }
      if (ci === 11) cell.numFmt = '0.0000';
      // col 16 (ci === 15): Остаток — format + colour by sign
      if (ci === 15) {
        const bal = val as number;
        cell.numFmt = '#,##0.00';
        cell.font = {
          size: 9, name: 'Calibri', bold: true,
          color: { argb: bal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` },
        };
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: bal >= 0 ? 'FFE8F8F5' : 'FFFDEDEC' } };
      }
    });

    // Col Q (17): «Часов» — empty, ready for user input (light yellow)
    const hoursCell = ws.getCell(rNum, 17);
    hoursCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
    hoursCell.numFmt = '0.00';

    // Col R (18): «Ставка/час» — Excel formula =IFERROR(H{n}/Q{n},"")
    const rateCell = ws.getCell(rNum, 18);
    rateCell.value = { formula: `IFERROR(H${rNum}/Q${rNum},"")` };
    rateCell.numFmt = '#,##0.00';
    rateCell.font = { size: 9, name: 'Calibri', italic: true };
    rateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
  });

  // ── Totals row ───────────────────────────────────────────────
  const totalRow = DATA_START + rows.length;
  if (rows.length > 0) {
    const tR = ws.getRow(totalRow);
    tR.height = 20;
    const totalLabel = ws.getCell(totalRow, 1);
    totalLabel.value = 'ИТОГО';
    totalLabel.font = { bold: true, size: 9, name: 'Calibri' };
    totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_BG}` } };

    // SUM for amount (col H) and Выплачено (col J) - signed
    const amtTotal = ws.getCell(totalRow, 8);
    amtTotal.value = { formula: `SUM(H${DATA_START}:H${totalRow - 1})` };
    amtTotal.numFmt = '#,##0.00';
    amtTotal.font = { bold: true, size: 9, name: 'Calibri' };
    amtTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_BG}` } };

    const debitTotal = ws.getCell(totalRow, 10);
    debitTotal.value = { formula: `SUM(J${DATA_START}:J${totalRow - 1})` };
    debitTotal.numFmt = '#,##0.00';
    debitTotal.font = { bold: true, size: 9, name: 'Calibri',
      color: { argb: 'FF333333' } };
    debitTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_BG}` } };
    // note: col J sums signed values (inflow + / outflow -)
    ws.getCell(totalRow, 11).value = '∑ ±';
    ws.getCell(totalRow, 11).font = { italic: true, size: 7, name: 'Calibri', color: { argb: 'FF888888' } };
    ws.getCell(totalRow, 11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_BG}` } };
  }

  // ── Task 0.2: Остатки по счетам на конец периода ────────────
  if (rows.length > 0) {
    const accBRow = DATA_START + rows.length + 2; // +1 ИТОГО +1 blank spacer
    ws.mergeCells(accBRow, 1, accBRow, 16);
    const accHdr = ws.getCell(accBRow, 1);
    accHdr.value = 'ОСТАТКИ ПО СЧЕТАМ НА КОНЕЦ ПЕРИОДА';
    accHdr.font = { bold: true, size: 9, color: { argb: `FF${C_COL_HDR_FG}` }, name: 'Calibri' };
    accHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_COL_HDR_BG}` } };

    // Per-account end balance (rows DESC → first occurrence = most recent)
    type BalSumm = { currency: string; endBal: string };
    const balMap = new Map<string, BalSumm>();
    for (const row of rows) {
      if (!balMap.has(row.account_name)) {
        balMap.set(row.account_name, { currency: row.account_currency, endBal: row.balance_after });
      }
    }

    let bRow = accBRow + 1;
    // Sub-header
    const subCols = ['Счёт', 'Валюта', 'Остаток'];
    subCols.forEach((h, i) => {
      const c = ws.getCell(bRow, i + 1);
      c.value = h;
      c.font = { bold: true, size: 8, name: 'Calibri' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    });
    bRow++;

    for (const [name, { currency, endBal }] of balMap) {
      const balNum = parseFloat(endBal);
      [name, currency, fmtAmtSigned(balNum)].forEach((v, i) => {
        const c = ws.getCell(bRow, i + 1);
        c.value = v;
        c.font = { size: 9, name: 'Calibri', color: balNum < 0 && i === 2 ? { argb: `FF${C_EXPENSE}` } : undefined };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      });
      bRow++;
    }
  }

  // ── Auto-filter on header row ────────────────────────────────
  ws.autoFilter = { from: { row: HDR_ROW, column: 1 }, to: { row: HDR_ROW, column: 16 } };

  // ── Freeze pane below header ──────────────────────────────────
  ws.views = [{ state: 'frozen', ySplit: HDR_ROW, xSplit: 0, activeCell: `A${DATA_START}` }];
}


// ─────────────────────────────────────────────────────────────
// Sheet 2: Счета
// ─────────────────────────────────────────────────────────────

function buildSheet2(wb: ExcelJS.Workbook, rows: TxRow[]): void {
  const ws = wb.addWorksheet('Счета');

  ws.mergeCells('A1:G1');
  const t = ws.getCell('A1');
  t.value = 'MIDAS · Сводка по счетам';
  t.font  = { bold: true, color: { argb: `FF${C_COL_HDR_FG}` }, size: 12, name: 'Calibri' };
  t.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  const headers = ['Счёт', 'Валюта', 'Тип', 'Доходы', 'Расходы', 'Долги', 'Чистый баланс'];
  const widths  = [20, 10, 14, 14, 14, 14, 16];
  headers.forEach((h, i) => hdr(ws, i + 1, 2, h, widths[i] ?? 14));
  ws.getRow(2).height = 24;

  // Group by account
  const accMap = new Map<string, { currency: string; type: string; income: number; expense: number; debt: number }>();
  for (const r of rows) {
    const key = r.account_name;
    const acc = accMap.get(key) ?? { currency: r.account_currency, type: r.account_type, income: 0, expense: 0, debt: 0 };
    const amt = parseFloat(r.original_amount);
    if (r.transaction_intent === 'income')    acc.income  += amt;
    if (r.transaction_intent === 'expense')   acc.expense += amt;
    if (r.transaction_intent === 'debt_given' || r.transaction_intent === 'debt_received') acc.debt += amt;
    accMap.set(key, acc);
  }

  let rowNum = 3;
  for (const [name, acc] of accMap) {
    const net = acc.income - acc.expense;
    const data = [name, acc.currency, acc.type, acc.income, acc.expense, acc.debt, net];
    data.forEach((val, ci) => {
      const cell = ws.getCell(rowNum, ci + 1);
      cell.value = val;
      if (ci >= 3) cell.numFmt = '#,##0.00';
      cell.font = { size: 9, name: 'Calibri', bold: ci === 6,
        color: ci === 6 ? { argb: net >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } : undefined };
      cell.fill = { type: 'pattern', pattern: 'solid',
        fgColor: { argb: rowNum % 2 === 0 ? `FF${C_ROW_ODD}` : 'FFFFFFFF' } };
    });
    rowNum++;
  }
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

// ─────────────────────────────────────────────────────────────
// Sheet 3: Категории
// ─────────────────────────────────────────────────────────────

function buildSheet3(wb: ExcelJS.Workbook, rows: TxRow[]): void {
  const ws = wb.addWorksheet('Категории');

  ws.mergeCells('A1:F1');
  const t = ws.getCell('A1');
  t.value = 'MIDAS · Сводка по категориям';
  t.font  = { bold: true, color: { argb: `FF${C_COL_HDR_FG}` }, size: 12, name: 'Calibri' };
  t.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  const headers = ['Группа', 'Категория', 'Транзакций', 'Расходы', 'Доходы', 'Долги'];
  const widths  = [14, 20, 12, 14, 14, 14];
  headers.forEach((h, i) => hdr(ws, i + 1, 2, h, widths[i] ?? 14));
  ws.getRow(2).height = 24;

  const catMap = new Map<string, { group: string; count: number; expense: number; income: number; debt: number }>();
  for (const r of rows) {
    const key = r.category_name;
    const cat = catMap.get(key) ?? { group: r.category_group, count: 0, expense: 0, income: 0, debt: 0 };
    const amt = parseFloat(r.original_amount);
    cat.count++;
    if (r.transaction_intent === 'expense')   cat.expense += amt;
    if (r.transaction_intent === 'income')    cat.income  += amt;
    if (r.transaction_intent.startsWith('debt')) cat.debt += amt;
    catMap.set(key, cat);
  }

  // Sort by expense desc
  const sorted = [...catMap.entries()].sort((a, b) => b[1].expense - a[1].expense);
  let rowNum = 3;
  for (const [name, cat] of sorted) {
    const data = [cat.group, name, cat.count, cat.expense, cat.income, cat.debt];
    data.forEach((val, ci) => {
      const cell = ws.getCell(rowNum, ci + 1);
      cell.value = val;
      if (ci >= 3) cell.numFmt = '#,##0.00';
      cell.font = { size: 9, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid',
        fgColor: { argb: rowNum % 2 === 0 ? `FF${C_ROW_ODD}` : 'FFFFFFFF' } };
    });
    rowNum++;
  }
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

// ─────────────────────────────────────────────────────────────
// Sheet 4: По месяцам
// ─────────────────────────────────────────────────────────────

function buildSheet4(wb: ExcelJS.Workbook, rows: TxRow[]): void {
  const ws = wb.addWorksheet('По месяцам');

  ws.mergeCells('A1:F1');
  const t = ws.getCell('A1');
  t.value = 'MIDAS · Динамика по месяцам';
  t.font  = { bold: true, color: { argb: `FF${C_COL_HDR_FG}` }, size: 12, name: 'Calibri' };
  t.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  const headers = ['Месяц', 'Доходы', 'Расходы', 'Долги выданы', 'Долги получены', 'Чистый'];
  const widths  = [18, 14, 14, 14, 14, 14];
  headers.forEach((h, i) => hdr(ws, i + 1, 2, h, widths[i] ?? 14));
  ws.getRow(2).height = 24;

  const monMap = new Map<string, { income: number; expense: number; debtGive: number; debtRecv: number }>();
  for (const r of rows) {
    const mon = fmtMon(new Date(r.transaction_time));
    const m   = monMap.get(mon) ?? { income: 0, expense: 0, debtGive: 0, debtRecv: 0 };
    const amt = parseFloat(r.original_amount);
    if (r.transaction_intent === 'income')         m.income    += amt;
    if (r.transaction_intent === 'expense')        m.expense   += amt;
    if (r.transaction_intent === 'debt_given')     m.debtGive  += amt;
    if (r.transaction_intent === 'debt_received')  m.debtRecv  += amt;
    monMap.set(mon, m);
  }

  let rowNum = 3;
  for (const [mon, m] of monMap) {
    const net = m.income - m.expense;
    const data = [mon, m.income, m.expense, m.debtGive, m.debtRecv, net];
    data.forEach((val, ci) => {
      const cell = ws.getCell(rowNum, ci + 1);
      cell.value = val;
      if (ci >= 1) cell.numFmt = '#,##0.00';
      cell.font = { size: 9, name: 'Calibri', bold: ci === 5,
        color: ci === 5 ? { argb: (net as number) >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } : undefined };
      cell.fill = { type: 'pattern', pattern: 'solid',
        fgColor: { argb: rowNum % 2 === 0 ? `FF${C_ROW_ODD}` : 'FFFFFFFF' } };
    });
    rowNum++;
  }
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}
