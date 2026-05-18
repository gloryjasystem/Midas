/**
 * Excel Export Service — Phase 2.x
 *
 * Generates a professional .xlsx file with all workspace transactions.
 * Uses exceljs for full styling support (colors, fonts, freeze panes, formulas).
 *
 * Sheet 0 — «Сводка»       : KPI summary, account balances, top categories, audit trail
 * Sheet 1 — «Транзакции»   : full transaction log, 18 columns (incl. hours + rate formula)
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

// ─────────────────────────────────────────────────────────────
// Smart number formatting
// ─────────────────────────────────────────────────────────────

/**
 * Crypto currencies that may have up to 8 significant decimal places.
 * All others are treated as fiat (max 2 dp).
 */
const CRYPTO_SET = new Set([
  'BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'TON', 'TRX', 'XRP',
  'DOGE', 'LTC', 'MATIC', 'DOT', 'ADA', 'AVAX', 'ATOM', 'LINK',
]);

// ─────────────────────────────────────────────────────────────
// Live exchange-rate fetcher
// ─────────────────────────────────────────────────────────────

/** Rate source tag for UI transparency */
type RateSource = 'hardcoded' | 'fiat-api' | 'crypto-api';

/**
 * Returns { rates, sources } where:
 *   rates   — Map<CURRENCY, USD_PER_1_UNIT>
 *   sources — Map<CURRENCY, RateSource>   (for transparent footnotes in Excel)
 *
 * Sources:
 *   • Stablecoins (USDT/USDC/BUSD/DAI) — hardcoded 1
 *   • Fiat — open.er-api.com (free, no API key)
 *   • Crypto — api.mexc.com (free, no API key, no strict geo-block)
 *   • Timeout 4s per provider, Graceful Degradation via Promise.allSettled
 */
async function fetchUsdRates(): Promise<{ rates: Map<string, number>; sources: Map<string, RateSource> }> {
  const rates   = new Map<string, number>();
  const sources = new Map<string, RateSource>();

  // ── Hardcoded stablecoins (always present, never overwritten) ──────────────
  const STABLES: Array<[string, number]> = [
    ['USD', 1], ['USDT', 1], ['USDC', 1],
    ['BUSD', 1], ['DAI', 1], ['TUSD', 1], ['USDP', 1],
  ];
  for (const [cur, rate] of STABLES) {
    rates.set(cur, rate);
    sources.set(cur, 'hardcoded');
  }

  const fetchFiat = async () => {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { result: string; rates: Record<string, number> };
    if (data.result === 'success' && data.rates) {
      for (const [cur, fxRate] of Object.entries(data.rates)) {
        const key = cur.toUpperCase();
        if (!rates.has(key) && fxRate > 0) {
          rates.set(key, 1 / fxRate);
          sources.set(key, 'fiat-api');
        }
      }
    }
  };

  const fetchCrypto = async () => {
    const res = await fetch('https://api.mexc.com/api/v3/ticker/price', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Array<{ symbol: string; price: string }>;
    for (const item of data) {
      if (item.symbol.endsWith('USDT')) {
        const coin  = item.symbol.slice(0, -4);
        const price = parseFloat(item.price);
        if (!rates.has(coin) && price > 0) {
          rates.set(coin, price);
          sources.set(coin, 'crypto-api');
        }
      }
    }
  };

  const results = await Promise.allSettled([fetchFiat(), fetchCrypto()]);
  results.forEach((r, idx) => {
    if (r.status === 'rejected') {
      const apiName = idx === 0 ? 'Fiat (er-api)' : 'Crypto (mexc)';
      console.warn(`[ExcelExport] ${apiName} fetch failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
    }
  });

  return { rates, sources };
}


/**
 * Returns the Excel numFmt string for a given currency:
 *   - Crypto  → '#,##0.########'   (up to 8 dp, no trailing zeros)
 *   - Fiat    → '#,##0.##'         (up to 2 dp, no trailing zeros)
 *
 * Examples:
 *   100        → "100"     (not "100.00")
 *   100.5      → "100.5"   (not "100.50")
 *   0.00012345 → "0.00012345"  (crypto precision)
 */
function smartNumFmt(currency: string): string {
  return CRYPTO_SET.has((currency ?? '').toUpperCase())
    ? '#,##0.########'
    : '#,##0.##';
}

/** Signed amount for summary cells: "+ 10 000" | "+ 10 000.50" | "− 1 000" | "—" */
function fmtAmtSigned(val: number, currency?: string): string {
  if (val === 0) return '—';
  const isCrypto = CRYPTO_SET.has((currency ?? '').toUpperCase());
  const decimals = isCrypto ? 8 : 2;
  // Strip trailing zeros after decimal
  let abs = Math.abs(val).toFixed(decimals).replace(/\.?0+$/, '');
  // Add space thousands separator
  abs = abs.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
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
         JOIN account_sources a ON a.id = tx.account_id AND a.deleted_at IS NULL
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
        LEFT JOIN account_sources a ON a.id = wb.account_id AND a.deleted_at IS NULL
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

  // ── Empty-state: 0 transactions in the selected period ─────────
  if (rows.length === 0) {
    const ws = wb.addWorksheet('Нет данных');
    ws.getColumn(1).width = 55;
    ws.getRow(1).height = 30;
    ws.mergeCells('A1:A3');
    const title = ws.getCell('A1');
    title.value = 'MIDAS — Финансовый отчёт';
    title.font  = { bold: true, size: 14, color: { argb: `FF${C_COL_HDR_FG}` }, name: 'Calibri' };
    title.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
    title.alignment = { horizontal: 'center', vertical: 'middle' };

    const msg = ws.getCell('A4');
    msg.value = `📭  За период ${fmtDate(from)} — ${fmtDate(to)} транзакций не найдено.`;
    msg.font  = { size: 11, name: 'Calibri', italic: true, color: { argb: 'FF555555' } };
    msg.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(4).height = 28;

    const hint = ws.getCell('A5');
    hint.value = 'Попробуйте расширить диапазон дат или выбрать другой счёт.';
    hint.font  = { size: 9, name: 'Calibri', color: { argb: 'FF888888' } };
    hint.alignment = { horizontal: 'center' };

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Fetch live rates once — fiat (er-api) + crypto (mexc) → USD, Promise.allSettled
  const { rates: usdRates, sources: rateSources } = await fetchUsdRates();

  buildSheet0Summary(wb, rows, from, to, usdRates, rateSources);
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

function buildSheet0Summary(
  wb: ExcelJS.Workbook,
  rows: TxRow[],
  from: Date,
  to: Date,
  usdRates: Map<string, number>,
  rateSources: Map<string, RateSource>,
): void {
  const ws = wb.addWorksheet('Сводка');

  const periodStr = `${fmtDate(from)} \u2014 ${fmtDate(to)}`;
  const days      = Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

  ws.getColumn(1).width = 22; // Валюта / Тип
  ws.getColumn(2).width = 38; // Нетто / Период
  ws.getColumn(3).width = 28; // Курс к USD
  ws.getColumn(4).width = 20; // ≈ USD
  ws.getColumn(5).width = 16; // Источник курса

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

  cell(r, 1, 'Период:', true);
  cell(r, 2, `${periodStr} (${String(days)} дн.)`);
  r++;
  cell(r, 1, 'Сформирован:', true);
  cell(r, 2, `${fmtDate(new Date())} ${fmtTime(new Date())}`);
  r++;
  r++; // spacer

  // ── СВОДКА ЗА ПЕРИОД ──────────────────────────────────────
  sectionHdr('СВОДКА ЗА ПЕРИОД');

  // Sub-headers for the intent block
  ['Тип операции', 'Операций', 'Сумма (USD)', 'Сумма (other)'].slice(0, 3).forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true, size: 8, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    c.alignment = { horizontal: i > 1 ? 'right' : 'left' };
  });
  // col 3 header «Сумма» spans to col 5
  ws.mergeCells(r, 3, r, 5);
  ws.getCell(r, 3).value = 'Суммы по валютам';
  ws.getCell(r, 3).font = { bold: true, size: 8, name: 'Calibri' };
  ws.getCell(r, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
  ws.getCell(r, 3).alignment = { horizontal: 'center' };
  r++;

  type IntentKey = 'income' | 'expense' | 'transfer' | 'debt_given' | 'debt_received';

  // Aggregate per intent AND per currency
  type IntentByCur = Record<IntentKey, { count: number; byCur: Map<string, number> }>;
  const im: IntentByCur = {
    income:        { count: 0, byCur: new Map() },
    expense:       { count: 0, byCur: new Map() },
    transfer:      { count: 0, byCur: new Map() },
    debt_given:    { count: 0, byCur: new Map() },
    debt_received: { count: 0, byCur: new Map() },
  };
  for (const row of rows) {
    const key = row.transaction_intent as IntentKey;
    if (!(key in im)) continue;
    im[key].count++;
    const amt = parseFloat(row.original_amount);
    im[key].byCur.set(row.currency, (im[key].byCur.get(row.currency) ?? 0) + amt);
  }


  const intentDefs: [string, IntentKey, 1 | -1][] = [
    ['💰 Доходы',       'income',        1],
    ['💸 Расходы',      'expense',       -1],
    ['🔄 Переводы',     'transfer',       1],
    ['🤝 Долги (дал)',  'debt_given',    -1],
    ['🤲 Долги (взял)', 'debt_received',  1],
  ];
  for (const [label, key, sign] of intentDefs) {
    const d = im[key];
    if (d.count === 0) continue; // skip types with zero activity
    cell(r, 1, label);
    cell(r, 2, countStr(d.count));
    // Render each currency on the same row, cols 3+
    let col = 3;
    for (const [cur, total] of d.byCur) {
      if (col > 5) break;
      const signed = sign * total;
      const c = ws.getCell(r, col);
      c.value = `${fmtAmtSigned(signed)} ${cur}`;
      c.font = { size: 9, name: 'Calibri',
        color: { argb: signed >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      c.alignment = { horizontal: 'left' };
      col++;
    }
    r++;
  }

  // ── Net per currency (income + debtRecv − expense − transfer − debtGiven) ──
  const allCurs = new Set<string>();
  for (const key of Object.keys(im) as IntentKey[]) {
    for (const cur of im[key].byCur.keys()) allCurs.add(cur);
  }

  interface ConvRow {
    currency: string;
    net:      number;
    rate:     number | null;
    usd:      number | null;
    source:   RateSource | 'uncovered';
  }
  const convRows: ConvRow[] = [];
  for (const cur of allCurs) {
    const net =
      (im.income.byCur.get(cur) ?? 0) +
      (im.debt_received.byCur.get(cur) ?? 0) -
      (im.expense.byCur.get(cur) ?? 0) -
      (im.transfer.byCur.get(cur) ?? 0) -
      (im.debt_given.byCur.get(cur) ?? 0);
    const rate   = usdRates.get(cur.toUpperCase()) ?? null;
    const source = (rateSources.get(cur.toUpperCase()) ?? 'uncovered') as RateSource | 'uncovered';
    convRows.push({ currency: cur, net, rate, usd: rate !== null ? net * rate : null, source });
  }

  const usdTotal    = convRows.reduce((s, x) => s + (x.usd ?? 0), 0);
  const uncoveredC  = convRows.filter(x => x.source === 'uncovered').map(x => x.currency);

  // ── Section header ────────────────────────────────────────────────────────
  sectionHdr('ИТОГ ЗА ПЕРИОД');

  // Sub-header row: column labels
  const colLabels = ['Валюта', 'Нетто за период', 'Курс к USD', '≈ USD', 'Источник курса'];
  colLabels.forEach((lbl, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = lbl;
    c.font  = { bold: true, size: 8, name: 'Calibri', color: { argb: 'FF555555' } };
    c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAD8A0' } };
    c.alignment = { horizontal: i >= 2 ? 'right' : 'left' };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });
  r++;

  // Data rows — one per currency
  for (const row of convRows) {
    const netClr  = row.net >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`;
    const usdClr  = (row.usd ?? 0) >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`;
    const fillBg  = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_TOTAL_BG}` } };

    // Col 1 — Currency code
    const c1 = ws.getCell(r, 1);
    c1.value = row.currency;
    c1.font  = { bold: true, size: 9, name: 'Calibri' };
    c1.fill  = fillBg;

    // Col 2 — Net amount in original currency
    const c2 = ws.getCell(r, 2);
    c2.value = fmtAmtSigned(row.net);
    c2.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: netClr } };
    c2.fill  = fillBg;
    c2.alignment = { horizontal: 'right' };

    // Col 3 — Exchange rate description
    const c3 = ws.getCell(r, 3);
    if (row.source === 'hardcoded') {
      c3.value = '1 : 1 (стейблкоин/USD)';
      c3.font  = { italic: true, size: 8, name: 'Calibri', color: { argb: 'FF888888' } };
    } else if (row.rate !== null) {
      c3.value = `1 ${row.currency} = ${row.rate.toFixed(4)} USD`;
      c3.font  = { size: 8, name: 'Calibri', color: { argb: 'FF444444' } };
    } else {
      c3.value = '— курс недоступен';
      c3.font  = { italic: true, size: 8, name: 'Calibri', color: { argb: 'FFE67E22' } };
    }
    c3.fill      = fillBg;
    c3.alignment = { horizontal: 'right' };

    // Col 4 — USD equivalent
    const c4 = ws.getCell(r, 4);
    if (row.usd !== null) {
      c4.value = fmtAmtSigned(row.usd);
      c4.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: usdClr } };
    } else {
      c4.value = 'не учтён';
      c4.font  = { italic: true, size: 8, name: 'Calibri', color: { argb: 'FFE67E22' } };
    }
    c4.fill      = fillBg;
    c4.alignment = { horizontal: 'right' };

    // Col 5 — Source tag
    const c5 = ws.getCell(r, 5);
    const srcLabel: Record<string, string> = {
      hardcoded:  'hardcoded',
      'fiat-api': 'er-api.com',
      'crypto-api': 'mexc.com',
      uncovered:  '—',
    };
    c5.value = srcLabel[row.source] ?? row.source;
    c5.font  = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
    c5.fill  = fillBg;
    c5.alignment = { horizontal: 'center' };

    r++;
  }

  // Separator row
  for (let ci = 1; ci <= 5; ci++) {
    ws.getCell(r, ci).border = { top: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    ws.getCell(r, ci).fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAD8A0' } };
  }
  r++;

  // Grand total USD row (yellow highlight)
  const gtFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF0CC' } };
  const gtClr  = usdTotal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`;

  const gt1 = ws.getCell(r, 1);
  gt1.value = '≈ ИТОГО в USD';
  gt1.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF555555' } };
  gt1.fill  = gtFill;

  const gt2 = ws.getCell(r, 2);
  gt2.value = uncoveredC.length > 0 ? `(без: ${uncoveredC.join(', ')})` : '(все валюты)';
  gt2.font  = { italic: true, size: 8, name: 'Calibri', color: { argb: 'FF888888' } };
  gt2.fill  = gtFill;

  const gt4 = ws.getCell(r, 4);
  gt4.value = `≈ ${fmtAmtSigned(usdTotal)} USD`;
  gt4.font  = { bold: true, size: 11, name: 'Calibri', color: { argb: gtClr } };
  gt4.fill  = gtFill;
  gt4.alignment = { horizontal: 'right' };

  for (const ci of [3, 5]) {
    ws.getCell(r, ci).fill = gtFill;
  }
  r++;

  // Footnote
  ws.mergeCells(r, 1, r, 5);
  const fn = ws.getCell(r, 1);
  const fnSources = [
    ...([...rateSources.values()].includes('fiat-api') ? ['Fiat: open.er-api.com'] : []),
    ...([...rateSources.values()].includes('crypto-api') ? ['Crypto: mexc.com'] : []),
    'Курс на дату экспорта отчёта',
    ...(uncoveredC.length > 0 ? [`Без конвертации: ${uncoveredC.join(', ')}`] : []),
  ];
  fn.value = fnSources.join(' · ');
  fn.font  = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
  fn.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
  r++;
  r++; // spacer


  // ── СОСТОЯНИЕ СЧЕТОВ ──────────────────────────────────────
  // We only show what we actually know:
  //   «Баланс сейчас»  = balance_after of the most recent transaction (true current balance)
  //   «Движение»       = net inflow/outflow during the selected period
  // We intentionally omit "balance at start of period" — the account may not have existed
  // at `from` date, so computing initial_balance and labelling it "balance on 01.05" is dishonest.
  sectionHdr('СОСТОЯНИЕ СЧЕТОВ');
  ['Счёт', 'Валюта', 'Баланс сейчас', 'Движение за период', ''].forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true, size: 8, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    c.alignment = { horizontal: i >= 2 ? 'right' : 'left' };
  });
  r++;

  // Per-account: rows are DESC sorted — first occurrence = most recent = current balance
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
    cell(r, 1, name);
    cell(r, 2, acc.currency);
    // Current balance — always truthful
    const balC = cell(r, 3, fmtAmtSigned(acc.endBal), false,
      acc.endBal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`);
    balC.alignment = { horizontal: 'right' };
    // Movement during period — net signed, with arrow and currency code
    const mv    = acc.netChange;
    const arrow = mv > 0 ? '▲ ' : mv < 0 ? '▼ ' : '';
    const mvClr = mv > 0 ? `FF${C_INCOME}` : mv < 0 ? `FF${C_EXPENSE}` : 'FF888888';
    const mvStr = mv === 0 ? '— нет операций' : `${arrow}${fmtAmtSigned(mv)} ${acc.currency}`;
    const mvC   = cell(r, 4, mvStr, false, mvClr);
    mvC.alignment = { horizontal: 'left' };
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

  // ── ТОП КАТЕГОРИЙ РАСХОДОВ (по валюте) ──────────────────
  // Each currency gets its own block — mixing currencies and computing % on a
  // combined total (e.g. UAH + USD) is mathematically meaningless.
  const catByCur = new Map<string, Map<string, { total: number; count: number }>>();
  for (const row of rows) {
    if (row.transaction_intent !== 'expense') continue;
    const cur = row.currency;
    if (!catByCur.has(cur)) catByCur.set(cur, new Map());
    const cm  = catByCur.get(cur)!;
    const k   = row.category_name;
    const cv  = cm.get(k) ?? { total: 0, count: 0 };
    cv.total += parseFloat(row.original_amount); cv.count++;
    cm.set(k, cv);
  }
  if (catByCur.size === 0) {
    sectionHdr('ТОП КАТЕГОРИЙ РАСХОДОВ');
    cell(r, 1, '— нет расходов за период'); r++;
  }
  for (const [cur, cm] of catByCur) {
    sectionHdr(`ТОП РАСХОДОВ — ${cur}`);
    const totalExpCur = im.expense.byCur.get(cur) ?? 1;
    const topCats = [...cm.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);
    for (const [i, [name, c]] of topCats.entries()) {
      const pct = Math.round((c.total / totalExpCur) * 100);
      cell(r, 1, `${String(i + 1)}.  ${name}`);
      cell(r, 2, countStr(c.count));
      cell(r, 3, `${fmtAmtSigned(-c.total)} ${cur}`);
      cell(r, 4, `${String(pct)}%`);
      r++;
    }
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

    // Row background: income → light green, expense → light red, else alternate stripes
    let bgColor: string;
    if (row.transaction_intent === 'income' || row.transaction_intent === 'debt_received') {
      bgColor = 'FFEAFAF1'; // light green
    } else if (row.transaction_intent === 'expense') {
      bgColor = 'FFFDEDEC'; // light red
    } else {
      const isOdd = idx % 2 === 0;
      bgColor = isOdd ? 'FFFFFFFF' : `FF${C_ROW_ODD}`;
    }

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
      // col H (ci=7): сумма в валюте транзакции
      if (ci === 7) cell.numFmt = smartNumFmt(row.currency);
      // col J (ci=9): Выплачено в валюте счёта — signed, colour by sign
      if (ci === 9) {
        const sv = val as number;
        cell.numFmt = smartNumFmt(debitCur);
        cell.font = { size: 9, name: 'Calibri',
          color: { argb: sv >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
      }
      // col L (ci=11): Курс — 4dp max, no trailing zeros
      if (ci === 11) cell.numFmt = '#,##0.####';
      // col P (ci=15): Остаток на счету — same currency as account
      if (ci === 15) {
        const bal = val as number;
        cell.numFmt = smartNumFmt(row.account_currency);
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
    amtTotal.numFmt = '#,##0.##';   // no trailing zeros on totals row
    amtTotal.font = { bold: true, size: 9, name: 'Calibri' };
    amtTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_BG}` } };

    const debitTotal = ws.getCell(totalRow, 10);
    debitTotal.value = { formula: `SUM(J${DATA_START}:J${totalRow - 1})` };
    debitTotal.numFmt = '#,##0.##'; // no trailing zeros on totals row
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
      if (ci >= 3) cell.numFmt = smartNumFmt(acc.currency);
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
      // Categories are mixed-currency — use generic fiat format (2dp, no trailing zeros)
      if (ci >= 3) cell.numFmt = '#,##0.##';
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

  // Sort months chronologically (key = "Январь 2026" — sort by year then month index)
  const RU_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                     'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const sortedMons = [...monMap.entries()].sort(([a], [b]) => {
    const parseMonKey = (k: string) => {
      const [mon, yr] = k.split(' ');
      return parseInt(yr ?? '0') * 12 + (RU_MONTHS.indexOf(mon ?? '') ?? 0);
    };
    return parseMonKey(a) - parseMonKey(b);
  });

  let rowNum = 3;
  for (const [mon, m] of sortedMons) {
    const net = m.income - m.expense;
    const data = [mon, m.income, m.expense, m.debtGive, m.debtRecv, net];
    data.forEach((val, ci) => {
      const cell = ws.getCell(rowNum, ci + 1);
      cell.value = val;
      // Monthly sheet is mixed-currency: use generic fiat format (2dp, no trailing zeros)
      if (ci >= 1) cell.numFmt = '#,##0.##';
      cell.font = { size: 9, name: 'Calibri', bold: ci === 5,
        color: ci === 5 ? { argb: (net as number) >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } : undefined };
      cell.fill = { type: 'pattern', pattern: 'solid',
        fgColor: { argb: rowNum % 2 === 0 ? `FF${C_ROW_ODD}` : 'FFFFFFFF' } };
    });
    rowNum++;
  }
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}
