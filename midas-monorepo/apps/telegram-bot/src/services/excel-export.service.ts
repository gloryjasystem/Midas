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
    case 'debt_given':    return '🤝 Долг (дал)';
    case 'debt_received': return '🤲 Долг (взял)';
    default:              return intent;
  }
}

function intentColour(intent: string): string {
  switch (intent) {
    case 'expense':       return C_EXPENSE;
    case 'income':        return C_INCOME;
    case 'debt_given':    return C_DEBT_GIVE;
    case 'debt_received': return C_DEBT_RECV;
    default:              return '000000';
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
): Promise<Buffer> {
  const from = dateFrom ?? new Date(0);
  const to   = dateTo   ?? new Date();

  const rows = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<TxRow>(
      `SELECT
         t.transaction_time,
         t.transaction_intent,
         t.original_amount::text,
         t.currency,
         t.account_debit_amount::text,
         t.account_debit_currency,
         COALESCE(t.exchange_rate, 1)::text AS exchange_rate,
         COALESCE(c.name, '—')   AS category_name,
         COALESCE(c.group::text, '—') AS category_group,
         COALESCE(a.name, '—')   AS account_name,
         COALESCE(a.currency, '—') AS account_currency,
         COALESCE(a.type::text, '—') AS account_type,
         t.item_name,
         p.canonical_name AS person_name
       FROM transactions t
       LEFT JOIN categories    c ON c.id = t.category_id
       LEFT JOIN account_sources a ON a.id = t.account_id
       LEFT JOIN persons        p ON p.id = t.person_id
       WHERE t.workspace_id = $1
         AND t.deleted_at IS NULL
         AND t.transaction_time >= $2
         AND t.transaction_time <= $3
       ORDER BY t.transaction_time DESC`,
      [workspaceId, from.toISOString(), to.toISOString()],
    );
    return r.rows;
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Midas Finance Bot';
  wb.created = new Date();

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

  // ── Rows 2–8: Summary block (right side K–N) ─────────────────
  const income   = rows.filter(r => r.transaction_intent === 'income')
                       .reduce((s, r) => s + parseFloat(r.original_amount), 0);
  const expense  = rows.filter(r => r.transaction_intent === 'expense')
                       .reduce((s, r) => s + parseFloat(r.original_amount), 0);
  const debtGive = rows.filter(r => r.transaction_intent === 'debt_given')
                       .reduce((s, r) => s + parseFloat(r.original_amount), 0);
  const debtRecv = rows.filter(r => r.transaction_intent === 'debt_received')
                       .reduce((s, r) => s + parseFloat(r.original_amount), 0);

  const summaryLines: [string, number][] = [
    ['💰 Доходы:', income],
    ['💸 Расходы:', expense],
    ['🤝 Долги (дал):', debtGive],
    ['🤲 Долги (взял):', debtRecv],
    ['📊 Чистый баланс:', income - expense],
  ];

  summaryLines.forEach(([label, val], idx) => {
    const rowNum = idx + 3;
    const labelCell = ws.getCell(rowNum, 12); // col L
    const valCell   = ws.getCell(rowNum, 13); // col M
    labelCell.value = label;
    labelCell.font = { bold: true, size: 9, name: 'Calibri' };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    labelCell.alignment = { horizontal: 'right' };
    valCell.value = parseFloat(val.toFixed(2));
    valCell.numFmt = '#,##0.00';
    valCell.font = {
      bold: idx === 4,
      color: idx === 4 ? { argb: val >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } : undefined,
      size: 9, name: 'Calibri',
    };
    valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    valCell.alignment = { horizontal: 'right' };
  });

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
    ['Ставка/час\n(вручную)', 13],
  ];
  cols.forEach(([text, width], i) => hdr(ws, i + 1, HDR_ROW, text, width));

  // ── Rows 11+: Data ───────────────────────────────────────────
  const DATA_START = 11;

  rows.forEach((row, idx) => {
    const rNum = DATA_START + idx;
    const wsRow = ws.getRow(rNum);
    wsRow.height = 18;

    const isOdd = idx % 2 === 0;
    const bgColor = isOdd ? 'FFFFFFFF' : `FF${C_ROW_ODD}`;

    const txDate = new Date(row.transaction_time);
    const amtNum  = parseFloat(row.original_amount);
    const debitNum = row.account_debit_amount ? parseFloat(row.account_debit_amount) : null;
    const rateNum  = parseFloat(row.exchange_rate ?? '1');
    const colour   = intentColour(row.transaction_intent);

    const cellValues: (string | number | null)[] = [
      idx + 1,
      fmtDate(txDate),
      fmtTime(txDate),
      localiseIntent(row.transaction_intent),
      row.person_name ?? '—',
      row.account_name,
      row.account_currency,
      amtNum,
      row.currency,
      debitNum,
      row.account_debit_currency ?? (debitNum ? row.account_currency : null),
      rateNum !== 1 ? rateNum : null,
      row.category_name,
      row.category_group,
      row.item_name ?? '',
      // Col P (16): empty — user fills hours; Col Q would be formula but we leave one col for it
    ];

    cellValues.forEach((val, ci) => {
      const cell = ws.getCell(rNum, ci + 1);
      cell.value = val;
      cell.font = { size: 9, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle' };

      // Colour amount (col H = 8) and type (col D = 4)
      if (ci === 3 || ci === 7) {
        cell.font = { size: 9, name: 'Calibri', color: { argb: `FF${colour}` }, bold: ci === 3 };
      }
      // Number format for amounts
      if (ci === 7 || ci === 9) cell.numFmt = '#,##0.00';
      if (ci === 11) cell.numFmt = '0.0000';
    });

    // Col P (16): «Часов» — empty, ready for user input
    const hoursCell = ws.getCell(rNum, 16);
    hoursCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } }; // light yellow hint
    hoursCell.numFmt = '0.00';

    // Col Q (17): «Ставка/час» — Excel formula =IFERROR(H{n}/P{n},"")
    const rateCell = ws.getCell(rNum, 17);
    rateCell.value = { formula: `IFERROR(H${rNum}/P${rNum},"")` };
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

    // SUM for amount (H) and debit (J)
    const amtTotal = ws.getCell(totalRow, 8);
    amtTotal.value = { formula: `SUM(H${DATA_START}:H${totalRow - 1})` };
    amtTotal.numFmt = '#,##0.00';
    amtTotal.font = { bold: true, size: 9, name: 'Calibri' };
    amtTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_BG}` } };

    const debitTotal = ws.getCell(totalRow, 10);
    debitTotal.value = { formula: `SUM(J${DATA_START}:J${totalRow - 1})` };
    debitTotal.numFmt = '#,##0.00';
    debitTotal.font = { bold: true, size: 9, name: 'Calibri' };
    debitTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_BG}` } };
  }

  // ── Auto-filter on header row ────────────────────────────────
  ws.autoFilter = { from: { row: HDR_ROW, column: 1 }, to: { row: HDR_ROW, column: 15 } };

  // ── Freeze first 10 rows (header + columns) ──────────────────
  ws.views = [{ state: 'frozen', ySplit: HDR_ROW, xSplit: 0, activeCell: `A${DATA_START}` }];

  hdr(ws, 16, HDR_ROW, 'Часов\n(вручную)', 13);
  hdr(ws, 17, HDR_ROW, 'Ставка/час\n(авто)', 13);
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
