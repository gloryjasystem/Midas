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

const C_HEADER_BG   = '1A3C5E'; // deep navy — sheet header / grand total bookend
const C_COL_HDR_BG  = '2D6A9F'; // mid-blue — section headers
const C_COL_HDR_FG  = 'FFFFFF';
const C_ROW_ODD     = 'F4F8FC';
const C_TOTAL_BG    = 'EEF5FB'; // light steel-blue — итог data rows (replaces amber)
const C_TOTAL_HDR   = 'D0E8F8'; // slightly darker steel-blue — sub-header of итог table
const C_GRAND_BG    = '1A3C5E'; // same navy as header — grand total row
const C_EXPENSE     = 'C0392B'; // red
const C_INCOME      = '27AE60'; // green
const C_DEBT_GIVE   = '2980B9'; // blue
const C_DEBT_RECV   = 'E67E22'; // orange
const C_GREY_BG     = 'F2F2F2'; // light grey — general cells
const C_TBL_BORDER  = 'BDD5E8'; // steel-blue border for all tables

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
 *   sources — Map<CURRENCY, RateSource>
 *
 * Priority (highest → lowest):
 *   1. Hardcoded stablecoins  (always 1:1, never overwritten)
 *   2. Fiat API  (open.er-api.com) — authoritative for all fiat currencies
 *   3. Crypto API (mexc.com) — only fills currencies NOT already covered by fiat
 *
 * WHY isolated maps + priority merge?
 *   MEXC lists thousands of tokens. Some have tickers that collide with fiat codes
 *   (e.g., MEXC has a token "PLN" ≈ 0.006 USDT, not the Polish Złoty ≈ 0.25 USD).
 *   Running both fetchers in parallel with a shared map causes a non-deterministic
 *   race: whichever API responds first "wins". The priority merge guarantees fiat
 *   always beats any MEXC token with the same ticker.
 */
async function fetchUsdRates(): Promise<{ rates: Map<string, number>; sources: Map<string, RateSource> }> {

  // ── Isolated staging maps per source ──────────────────────────────────────
  const fiatStaging   = new Map<string, number>();
  const cryptoStaging = new Map<string, number>();

  const fetchFiat = async () => {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { result: string; rates: Record<string, number> };
    if (data.result === 'success' && data.rates) {
      for (const [cur, fxRate] of Object.entries(data.rates)) {
        if (fxRate > 0) fiatStaging.set(cur.toUpperCase(), 1 / fxRate);
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
      // Only accept *USDT pairs for coins in our known CRYPTO_SET.
      // This prevents MEXC tokens like "PLN", "UAH", "RUB" (DeFi projects)
      // from poisoning real fiat exchange rates.
      if (item.symbol.endsWith('USDT')) {
        const coin  = item.symbol.slice(0, -4).toUpperCase();
        const price = parseFloat(item.price);
        if (CRYPTO_SET.has(coin) && price > 0) {
          cryptoStaging.set(coin, price);
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

  // ── Priority merge: hardcoded → fiat → crypto ─────────────────────────────
  const rates   = new Map<string, number>();
  const sources = new Map<string, RateSource>();

  // 1. Hardcoded stablecoins (highest priority — immutable)
  for (const cur of ['USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP']) {
    rates.set(cur, 1);
    sources.set(cur, 'hardcoded');
  }

  // 2. Fiat API (fills all fiat; never overwrites stablecoins)
  for (const [cur, rate] of fiatStaging) {
    if (!rates.has(cur)) {
      rates.set(cur, rate);
      sources.set(cur, 'fiat-api');
    }
  }

  // 3. Crypto API (fills only what fiat didn't cover — strict CRYPTO_SET only)
  for (const [cur, rate] of cryptoStaging) {
    if (!rates.has(cur)) {
      rates.set(cur, rate);
      sources.set(cur, 'crypto-api');
    }
  }

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
  buildSheet1(wb, rows, from, to, usdRates);
  buildSheet2(wb, rows, usdRates);
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
  ws.getColumn(4).width = 14; // %
  ws.getColumn(5).width = 34; // Все расходы

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

  // #2 — Meta rows: steel-blue background (matches ИТОГ ЗА ПЕРИОД data rows)
  const metaBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_TOTAL_BG}` } };
  [1, 2, 3, 4, 5].forEach(ci => { ws.getCell(r, ci).fill = metaBg; });
  cell(r, 1, 'Период:', true); ws.getCell(r, 1).fill = metaBg;
  cell(r, 2, `${periodStr} (${String(days)} дн.)`); ws.getCell(r, 2).fill = metaBg;
  r++;
  [1, 2, 3, 4, 5].forEach(ci => { ws.getCell(r, ci).fill = metaBg; });
  cell(r, 1, 'Сформирован:', true); ws.getCell(r, 1).fill = metaBg;
  cell(r, 2, `${fmtDate(new Date())} ${fmtTime(new Date())}`); ws.getCell(r, 2).fill = metaBg;
  r++;
  r++; // spacer

  // ── СВОДКА ЗА ПЕРИОД ──────────────────────────────────────
  sectionHdr('СВОДКА ЗА ПЕРИОД');

  // Individual column headers — consistent with the ИТОГ table structure below
  // #5 — "Суммы по валютам" merged C-E, centered
  ['Тип операции', 'Операций', 'Суммы по валютам', '', ''].forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true, size: 8, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    c.alignment = { horizontal: i === 2 ? 'center' : 'left', vertical: 'middle' };
    c.border = { bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
  });
  // merge C-E for the label (cols 3-5)
  ws.mergeCells(r, 3, r, 5);
  ws.getRow(r).height = 16;
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
    ['🔄 Переводы',     'transfer',      -1],
    ['🤝 Долги (дал)',  'debt_given',    -1],
    ['🤲 Долги (взял)', 'debt_received',  1],
  ];
  for (const [label, key, sign] of intentDefs) {
    const d = im[key];
    if (d.count === 0) continue;
    cell(r, 1, label);
    cell(r, 2, countStr(d.count));
    let col = 3;
    for (const [cur, total] of d.byCur) {
      if (col > 5) break;
      const signed = sign * total;
      const c = ws.getCell(r, col);
      c.value = `${fmtAmtSigned(signed)} ${cur}`;
      c.font = { size: 9, name: 'Calibri',
        color: { argb: signed >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      // #4 — center-align amounts in cols C-E of СВОДКА ЗА ПЕРИОД
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      col++;
    }
    // fill remaining cols with grey
    for (let ci = col; ci <= 5; ci++) {
      ws.getCell(r, ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    }
    // thin border on each row
    for (let ci = 1; ci <= 5; ci++) {
      const bc = ws.getCell(r, ci);
      bc.border = {
        bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } },
        right:  { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } },
      };
    }
    ws.getRow(r).height = 18;
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
  const thinBorder = {
    top:    { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    bottom: { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    left:   { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };
  const colLabels = ['Валюта', 'Нетто за период', 'Курс к USD', 'USD', 'Источник'];
  colLabels.forEach((lbl, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = lbl;
    c.font  = { bold: true, size: 8, name: 'Calibri', color: { argb: 'FF2D6A9F' } };
    c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_HDR}` } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = thinBorder;
  });
  ws.getRow(r).height = 16;
  r++;

  // Data rows — one per currency
  for (const row of convRows) {
    const netClr = row.net >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`;
    const usdClr = (row.usd ?? 0) >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`;
    const fillBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_TOTAL_BG}` } };

    // Col 1 — Currency code (bold, left)
    const c1 = ws.getCell(r, 1);
    c1.value = row.currency;
    c1.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF333333' } };
    c1.fill  = fillBg;
    c1.border = thinBorder;
    c1.alignment = { horizontal: 'left', vertical: 'middle' };

    // Col 2 — Net amount (right-aligned, coloured)
    const c2 = ws.getCell(r, 2);
    c2.value = fmtAmtSigned(row.net);
    c2.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: netClr } };
    c2.fill  = fillBg;
    c2.border = thinBorder;
    c2.alignment = { horizontal: 'right', vertical: 'middle' };

    // Col 3 — Exchange rate (right-aligned, descriptive)
    const c3 = ws.getCell(r, 3);
    if (row.source === 'hardcoded') {
      c3.value = '1 : 1  (стейблкоин)';
      c3.font  = { italic: true, size: 8, name: 'Calibri', color: { argb: 'FF888888' } };
    } else if (row.rate !== null) {
      c3.value = `1 ${row.currency} = ${row.rate.toFixed(4)} USD`;
      c3.font  = { size: 8, name: 'Calibri', color: { argb: 'FF444444' } };
    } else {
      c3.value = '— курс недоступен';
      c3.font  = { italic: true, size: 8, name: 'Calibri', color: { argb: 'FFE67E22' } };
    }
    c3.fill      = fillBg;
    c3.border    = thinBorder;
    c3.alignment = { horizontal: 'center', vertical: 'middle' };

    // Col 4 — ≈ USD equivalent (right-aligned, coloured)
    const c4 = ws.getCell(r, 4);
    if (row.usd !== null) {
      c4.value = fmtAmtSigned(row.usd);
      c4.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: usdClr } };
    } else {
      c4.value = 'не учтён';
      c4.font  = { italic: true, size: 8, name: 'Calibri', color: { argb: 'FFE67E22' } };
    }
    c4.fill      = fillBg;
    c4.border    = thinBorder;
    c4.alignment = { horizontal: 'right', vertical: 'middle' };

    // Col 5 — Source tag (small, grey, centred)
    const c5 = ws.getCell(r, 5);
    // #7 — Human-readable rate source labels
    const srcLabel: Record<string, string> = {
      hardcoded:    '—',
      'fiat-api':   'Fiat',
      'crypto-api': 'Crypto',
      uncovered:    '?',
    };
    c5.value = srcLabel[row.source] ?? row.source;
    c5.font  = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
    c5.fill  = fillBg;
    c5.border = thinBorder;
    c5.alignment = { horizontal: 'center', vertical: 'middle' };

    r++;
  }

  // ── Grand total row — NAVY bookend (mirrors sheet title) ────────────────
  const gtFill   = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_GRAND_BG}` } };
  const gtBorder = {
    top:    { style: 'medium' as const, color: { argb: 'FF0D2840' } },
    bottom: { style: 'medium' as const, color: { argb: 'FF0D2840' } },
    left:   { style: 'thin'   as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin'   as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };

  // Merge cols 1-3 for label → right-aligned text visually "touches" the value in col 4
  ws.mergeCells(r, 1, r, 3);
  const gt1 = ws.getCell(r, 1);
  gt1.value = uncoveredC.length > 0
    ? `ИТОГО в USD  (без: ${uncoveredC.join(', ')})`
    : 'ИТОГО в USD';
  gt1.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FFB0C8E0' } };
  gt1.fill  = gtFill;
  gt1.border = gtBorder;
  gt1.alignment = { horizontal: 'right', vertical: 'middle' };

  // USD number — compact, right-aligned, colour-coded
  const usdTotalClr = usdTotal >= 0 ? 'FF7DCEA0' : 'FFE57373'; // soft green/red on dark bg
  const gt4 = ws.getCell(r, 4);
  gt4.value = `${fmtAmtSigned(usdTotal)} USD`;
  gt4.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: usdTotalClr } };
  gt4.fill  = gtFill;
  gt4.border = gtBorder;
  gt4.alignment = { horizontal: 'right', vertical: 'middle' };

  const gt5 = ws.getCell(r, 5);
  gt5.fill   = gtFill;
  gt5.border = gtBorder;

  ws.getRow(r).height = 20;
  r++;

  // Footnote (merged, small grey)
  ws.mergeCells(r, 1, r, 5);
  const fn = ws.getCell(r, 1);
  const fnParts = [
    'Курс на дату экспорта',
    ...(([...rateSources.values()].includes('fiat-api')) ? ['Fiat: open.er-api.com'] : []),
    ...(([...rateSources.values()].includes('crypto-api')) ? ['Crypto: mexc.com'] : []),
    ...(uncoveredC.length > 0 ? [`без конвертации: ${uncoveredC.join(', ')}`] : []),
  ];
  fn.value = fnParts.join('  ·  ');
  fn.font  = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
  fn.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
  // Thin top border separates audit disclaimer from the grand total value above
  fn.border = { top: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
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
    // Баланс и Движение — centre-aligned (financial table standard)
    c.alignment = { horizontal: i >= 2 ? 'center' : 'left', vertical: 'middle' };
    c.border = { bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
  });
  ws.getRow(r).height = 16;
  r++;

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
    // Balance: no '+' prefix for positive — bank statement standard (Revolut/Wise style)
    const balDisplay = acc.endBal >= 0
      ? fmtAmtSigned(acc.endBal).replace(/^\+ /, '')
      : fmtAmtSigned(acc.endBal);
    const balC = cell(r, 3, balDisplay, false,
      acc.endBal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`);
    balC.alignment = { horizontal: 'center', vertical: 'middle' };
    const mv    = acc.netChange;
    const arrow = mv > 0 ? '▲ ' : mv < 0 ? '▼ ' : '';
    const mvClr = mv > 0 ? `FF${C_INCOME}` : mv < 0 ? `FF${C_EXPENSE}` : 'FF888888';
    // Currency is already shown in col B — no duplication in movement string
    const mvStr = mv === 0 ? '— нет операций' : `${arrow}${fmtAmtSigned(mv)}`;
    const mvC   = cell(r, 4, mvStr, false, mvClr);
    mvC.alignment = { horizontal: 'center', vertical: 'middle' };
    // #2 — fill col 5 with grey so accounts section has no white gap
    const e5 = ws.getCell(r, 5);
    e5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    // thin bottom border on every account row
    for (let ci = 1; ci <= 5; ci++) {
      ws.getCell(r, ci).border = { bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
    }
    ws.getRow(r).height = 18;
    r++;
  }
  r++; // spacer

  // ── СВОДКА ПО ВАЛЮТАМ ─────────────────────────────────────
  // Design: per-currency block with horizontal operation-type breakdown.
  // Each currency row shows: flag | currency code | op count | coloured net amount.
  // Below each row — a compact inline breakdown by intent (income / expense / transfer etc).
  sectionHdr('СВОДКА ПО ВАЛЮТАМ');

  // Sub-header columns: Currency | Операций | Нетто | (breakdown) | Нетто итого
  // #3 — col E gets header "Нетто", center-aligned
  ['Валюта', 'Операций', 'Нетто за период', '', 'Нетто'].forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true, size: 8, name: 'Calibri', color: { argb: 'FF2D6A9F' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_HDR}` } };
    c.alignment = { horizontal: i === 4 ? 'center' : i >= 2 ? 'right' : 'left', vertical: 'middle' };
    c.border = { bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
  });
  ws.getRow(r).height = 16;
  r++;

  // Aggregate by currency across ALL intents
  type CurTotals2 = {
    count: number;
    income: number;
    expense: number;
    transfer: number;
    debtGiven: number;
    debtReceived: number;
  };
  const byCur = new Map<string, CurTotals2>();
  for (const row of rows) {
    const cur = row.currency;
    const t = byCur.get(cur) ?? { count: 0, income: 0, expense: 0, transfer: 0, debtGiven: 0, debtReceived: 0 };
    t.count++;
    const amt = parseFloat(row.original_amount);
    if (row.transaction_intent === 'income')        t.income       += amt;
    if (row.transaction_intent === 'expense')       t.expense      += amt;
    if (row.transaction_intent === 'transfer')      t.transfer     += amt;
    if (row.transaction_intent === 'debt_given')    t.debtGiven    += amt;
    if (row.transaction_intent === 'debt_received') t.debtReceived += amt;
    byCur.set(cur, t);
  }

  const thinB = {
    top:    { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    bottom: { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    left:   { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };

  for (const [cur, t] of byCur) {
    const net = t.income + t.debtReceived - t.expense - t.transfer - t.debtGiven;
    const netClr = net >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`;
    const fillBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_TOTAL_BG}` } };

    // Col 1 — Currency code (bold)
    const c1 = ws.getCell(r, 1);
    c1.value = cur;
    c1.font = { bold: true, size: 10, name: 'Calibri', color: { argb: 'FF1A3C5E' } };
    c1.fill = fillBg;
    c1.border = thinB;
    c1.alignment = { horizontal: 'left', vertical: 'middle' };

    // Col 2 — Op count
    const c2 = ws.getCell(r, 2);
    c2.value = countStr(t.count);
    c2.font = { size: 8, name: 'Calibri', color: { argb: 'FF666666' } };
    c2.fill = fillBg;
    c2.border = thinB;
    c2.alignment = { horizontal: 'left', vertical: 'middle' };

    // Cols 3-5 — Breakdown line: show each non-zero intent inline
    const parts: string[] = [];
    if (t.income       > 0) parts.push(`💰 +${fmtAmtSigned(t.income).replace('+ ', '')}`);
    if (t.debtReceived > 0) parts.push(`🤲 +${fmtAmtSigned(t.debtReceived).replace('+ ', '')}`);
    if (t.expense      > 0) parts.push(`💸 ${fmtAmtSigned(-t.expense)}`);
    if (t.transfer     > 0) parts.push(`🔄 ${fmtAmtSigned(-t.transfer)}`);
    if (t.debtGiven    > 0) parts.push(`🤝 ${fmtAmtSigned(-t.debtGiven)}`);

    ws.mergeCells(r, 3, r, 4);
    const c3 = ws.getCell(r, 3);
    c3.value = parts.join('   ');
    c3.font = { size: 8, name: 'Calibri', color: { argb: 'FF444444' } };
    c3.fill = fillBg;
    c3.border = thinB;
    c3.alignment = { horizontal: 'left', vertical: 'middle' };

    // Col 5 — Net amount coloured, center-aligned
    // #3 — center-align net amount in col E of currency summary
    const c5 = ws.getCell(r, 5);
    c5.value = `${fmtAmtSigned(net)} ${cur}`;
    c5.font = { bold: true, size: 9, name: 'Calibri', color: { argb: netClr } };
    c5.fill = fillBg;
    c5.border = thinB;
    c5.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.getRow(r).height = 20;
    r++;
  }
  r++; // spacer

  // ── ТОП РАСХОДОВ (USD) ─────────────────────────────────────
  // Single unified block: all expense transactions converted to USD via usdRates,
  // aggregated by category name, sorted by USD-equivalent descending.

  /** Emoji icon for well-known category names (matches default 28 categories in DB) */
  function categoryIcon(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('продукт'))            return '🛒';
    if (n.includes('кафе') || n.includes('ресторан')) return '🍽️';
    if (n.includes('транспорт'))          return '🚗';
    if (n.includes('жиль') || n.includes('аренд'))   return '🏠';
    if (n.includes('здоров'))             return '💊';
    if (n.includes('одежда') || n.includes('одежд')) return '👗';
    if (n.includes('красота'))            return '💅';
    if (n.includes('развлечени'))         return '🎮';
    if (n.includes('подписк'))            return '📱';
    if (n.includes('связь'))              return '📡';
    if (n.includes('образовани'))         return '📚';
    if (n.includes('спорт'))              return '🏋️';
    if (n.includes('путешест'))           return '✈️';
    if (n.includes('подарок') || n.includes('подарки')) return '🎁';
    if (n.includes('дети'))               return '👶';
    if (n.includes('зарплат') || n.includes('выплат')) return '💼';
    if (n.includes('фриланс'))            return '💻';
    if (n.includes('реклам'))             return '📣';
    if (n.includes('софт') || n.includes('сервис'))   return '⚙️';
    if (n.includes('оборудован'))         return '🖥️';
    if (n.includes('офис'))               return '🏢';
    if (n.includes('налог'))              return '🏦';
    if (n.includes('комисси'))            return '💳';
    if (n.includes('крипто'))             return '₿';
    if (n.includes('подрядчик'))          return '👷';
    if (n.includes('продажи'))            return '📈';
    if (n.includes('инвестиц'))           return '💹';
    return '📂'; // generic fallback
  }

  // Aggregate all expense rows by category → USD equivalent
  type CatSummary = {
    totalUsd:  number;
    originals: Map<string, number>; // currency → amount (for "Все расходы" col)
    uncovered: Map<string, number>; // currency → amount (no rate available)
    count:     number;
  };
  const catMap = new Map<string, CatSummary>();

  // #5 — Include expense + transfer + debt in category aggregation
  const OUT_INTENTS = new Set(['expense', 'transfer', 'debt', 'debt_given']);
  for (const row of rows) {
    if (!OUT_INTENTS.has(row.transaction_intent)) continue;
    const name = row.category_name;
    const cur  = row.currency.toUpperCase();
    const amt  = parseFloat(row.original_amount);
    const rate = usdRates.get(cur) ?? null;
    const cs   = catMap.get(name) ?? { totalUsd: 0, originals: new Map(), uncovered: new Map(), count: 0 };
    cs.count++;
    if (rate !== null) {
      cs.totalUsd += amt * rate;
      cs.originals.set(cur, (cs.originals.get(cur) ?? 0) + amt);
    } else {
      cs.uncovered.set(cur, (cs.uncovered.get(cur) ?? 0) + amt);
    }
    catMap.set(name, cs);
  }

  // grandTotalUsd for % — computed across ALL categories before slicing top-8
  const grandTotalUsd = [...catMap.values()].reduce((s, cs) => s + cs.totalUsd, 0);

  // Split: has USD equiv (main list) vs fully uncovered (appendix)
  const mainTopList = [...catMap.entries()]
    .filter(([, cs]) => cs.totalUsd > 0)
    .sort((a, b) => b[1].totalUsd - a[1].totalUsd)
    .slice(0, 8);
  const uncoveredOnlyList = [...catMap.entries()]
    .filter(([, cs]) => cs.totalUsd === 0 && cs.uncovered.size > 0);

  // #1 — Section title
  sectionHdr('ТОП РАСХОДОВ ПО КАТЕГОРИЯМ (USD)');

  if (catMap.size === 0) {
    cell(r, 1, '— нет расходов за период'); r++;
  } else {
    // #9 — Subtitle: explains how USD total is derived
    ws.mergeCells(r, 1, r, 5);
    const subNote = ws.getCell(r, 1);
    subNote.value = 'суммы конвертированы в USD по курсам на дату отчёта';
    subNote.font  = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
    subNote.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    subNote.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(r).height = 12;
    r++;

    // #3 — Sub-header: grey bg, col A = '#'
    const topHdrs = ['#', 'Категория', 'USD', '%', 'Все расходы'];
    topHdrs.forEach((h, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = h;
      c.font = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF2D6A9F' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      c.alignment = { horizontal: i === 3 ? 'center' : i === 0 ? 'right' : 'left', vertical: 'middle' };
      c.border = { bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
    });
    ws.getRow(r).height = 16;
    r++;

    // #8 — Largest Remainder Method for % (ensures sum = 100%)
    const lrFloors = mainTopList.map(([, cs]) =>
      grandTotalUsd > 0 ? Math.floor((cs.totalUsd / grandTotalUsd) * 100) : 0
    );
    const lrRemainder = 100 - lrFloors.reduce((a, b) => a + b, 0);
    const lrOrder = mainTopList
      .map((entry, i) => ({
        i,
        frac: grandTotalUsd > 0 ? (entry[1].totalUsd / grandTotalUsd) * 100 % 1 : 0,
      }))
      .sort((a, b) => b.frac - a.frac);
    const lrPcts = [...lrFloors];
    lrOrder.slice(0, lrRemainder).forEach(({ i }) => { lrPcts[i] = (lrPcts[i] ?? 0) + 1; });

    // #1 — fmtK always shows minus (outflow context, originals stored as positive)
    const fmtK = (amt: number, cur: string): string => {
      const abs = Math.abs(amt);
      if (abs >= 10000) return `− ${(abs / 1000).toFixed(1).replace(/\.0$/, '')}K ${cur}`;
      return `${fmtAmtSigned(-abs)} ${cur}`;
    };

    // Data rows — top-8
    for (const [idx, [name, cs]] of mainTopList.entries()) {
      const pct  = lrPcts[idx];
      const icon = categoryIcon(name);

      // Col 1 — rank
      const rc1 = ws.getCell(r, 1);
      rc1.value = `${idx + 1}.`;
      rc1.font = { size: 11, bold: true, name: 'Calibri', color: { argb: 'FF444444' } };
      rc1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      rc1.alignment = { horizontal: 'right', vertical: 'middle' };

      // Col 2 — icon + category name
      const rc2 = ws.getCell(r, 2);
      rc2.value = `${icon}  ${name}`;
      rc2.font = { size: 9, name: 'Calibri', color: { argb: 'FF333333' } };
      rc2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      rc2.alignment = { horizontal: 'left', vertical: 'middle' };

      // Col 3 — USD equivalent (left-aligned, bold red)
      const rc3 = ws.getCell(r, 3);
      rc3.value = `${fmtAmtSigned(-cs.totalUsd)} USD`;
      rc3.font = { size: 10, bold: true, name: 'Calibri', color: { argb: `FF${C_EXPENSE}` } };
      rc3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      rc3.alignment = { horizontal: 'left', vertical: 'middle' };

      // Col 4 — percentage (center-aligned, muted, Largest Remainder)
      const rc4 = ws.getCell(r, 4);
      rc4.value = `${String(pct)}%`;
      rc4.font = { size: 9, name: 'Calibri', color: { argb: 'FF888888' } };
      rc4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      rc4.alignment = { horizontal: 'center', vertical: 'middle' };

      // Col 5 — always show original currencies breakdown
      const origParts: string[] = [];
      for (const [cur, amt] of cs.originals) origParts.push(fmtK(amt, cur));
      if (cs.uncovered.size > 0) {
        for (const [cur, amt] of cs.uncovered) origParts.push(`${fmtAmtSigned(-amt)} ${cur} (?)`);
      }
      const rc5 = ws.getCell(r, 5);
      rc5.value = origParts.join('  |  ');
      rc5.font = { size: 8, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
      rc5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      rc5.alignment = { horizontal: 'left', vertical: 'middle' };

      for (let ci = 1; ci <= 5; ci++) {
        ws.getCell(r, ci).border = { bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
      }
      ws.getRow(r).height = 18;
      r++;
    }

    // Optional appendix: categories with no convertible rate at all
    if (uncoveredOnlyList.length > 0) {
      ws.mergeCells(r, 1, r, 5);
      const uHdr = ws.getCell(r, 1);
      uHdr.value = 'Не конвертировано в USD';
      uHdr.font = { bold: true, size: 8, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
      uHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      uHdr.border = { bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
      ws.getRow(r).height = 14;
      r++;

      for (const [name, cs] of uncoveredOnlyList) {
        const icon  = categoryIcon(name);
        const parts: string[] = [];
        for (const [cur, amt] of cs.uncovered) parts.push(`${fmtAmtSigned(-amt)} ${cur}`);

        const uc1 = ws.getCell(r, 1);
        uc1.value = '—';
        uc1.font = { size: 9, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
        uc1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
        uc1.alignment = { horizontal: 'right', vertical: 'middle' };

        const uc2 = ws.getCell(r, 2);
        uc2.value = `${icon}  ${name}`;
        uc2.font = { size: 9, name: 'Calibri', color: { argb: 'FF777777' } };
        uc2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
        uc2.alignment = { horizontal: 'left', vertical: 'middle' };

        ws.mergeCells(r, 3, r, 4);
        const uc3 = ws.getCell(r, 3);
        uc3.value = '—';
        uc3.font = { size: 9, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
        uc3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
        uc3.alignment = { horizontal: 'center', vertical: 'middle' };

        const uc5 = ws.getCell(r, 5);
        uc5.value = parts.join(' · ');
        uc5.font = { size: 8, italic: true, name: 'Calibri', color: { argb: 'FF888888' } };
        uc5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
        uc5.alignment = { horizontal: 'left', vertical: 'middle' };

        ws.getRow(r).height = 18;
        r++;
      }
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

  // Freeze row 1 (title always visible when scrolling)
  ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];
  // Navy tab to match sheet identity
  ws.properties.tabColor = { argb: `FF${C_HEADER_BG}` };
}

// ─────────────────────────────────────────────────────────────
// Sheet 1: Транзакции
// ─────────────────────────────────────────────────────────────

function buildSheet1(wb: ExcelJS.Workbook, rows: TxRow[], from: Date, to: Date, usdRates: Map<string, number>): void {
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

  // ── Summary block (rows 2–9, cols I–K): «Сводка по валютам» dashboard card ──
  // Styled as embedded summary card: navy header + #F2F7FB background + steel-blue border
  // (Mirrors QuickBooks/Xero export design pattern)
  const SUMM_COL_START = 9;   // I
  const SUMM_COL_END   = 11;  // K
  const SUMM_ROW_START = 2;

  // Row 2: Navy merged header
  ws.mergeCells(SUMM_ROW_START, SUMM_COL_START, SUMM_ROW_START, SUMM_COL_END);
  const summHdrCell = ws.getCell(SUMM_ROW_START, SUMM_COL_START);
  summHdrCell.value = `Сводка по валютам · ${rows.length} операций`;
  summHdrCell.font = { bold: true, size: 9, name: 'Calibri', color: { argb: `FF${C_COL_HDR_FG}` } };
  summHdrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  summHdrCell.alignment = { horizontal: 'center', vertical: 'middle' };
  // Apply outer border to header row cells
  const summBorder = { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } };
  summHdrCell.border = { top: summBorder, left: summBorder, right: summBorder, bottom: summBorder };

  // Rows 3–9: fill per currency (max 7 rows), #F2F7FB background + full border frame
  let summRow = 3;
  for (const [cur, t] of byCur) {
    if (summRow > 9) break;
    const net = t.income + t.debtRecv - t.expense - t.transfer - t.debtGive;
    const summDataFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF2F7FB' } };
    const summDataBorder = {
      top:    summBorder,
      bottom: summBorder,
      left:   summBorder,
      right:  summBorder,
    };

    const lc = ws.getCell(summRow, SUMM_COL_START);
    lc.value = `${cur}  💰${t.income.toFixed(0)}  💸${t.expense.toFixed(0)}  🔄${t.transfer.toFixed(0)}`;
    lc.font  = { size: 8, name: 'Calibri', color: { argb: 'FF333333' } };
    lc.fill  = summDataFill;
    lc.border = summDataBorder;
    lc.alignment = { horizontal: 'left', vertical: 'middle' };

    const vc = ws.getCell(summRow, 10);
    vc.value  = parseFloat(net.toFixed(2));
    vc.numFmt = '+#,##0.00;-#,##0.00';
    vc.font   = { bold: true, size: 8, name: 'Calibri',
      color: { argb: net >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
    vc.fill   = summDataFill;
    vc.border = summDataBorder;
    vc.alignment = { horizontal: 'right', vertical: 'middle' };

    const cc = ws.getCell(summRow, SUMM_COL_END);
    cc.value = cur;
    cc.font  = { italic: true, size: 8, name: 'Calibri', color: { argb: '55555555' } };
    cc.fill  = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF2F7FB' } };
    cc.border = summDataBorder;
    cc.alignment = { horizontal: 'left', vertical: 'middle' };
    summRow++;
  }

  // Pad remaining rows in the dashboard block (rows after last currency, up to row 9)
  // This ensures the card has a clean rectangular appearance even with few currencies
  for (let padRow = summRow; padRow <= 9; padRow++) {
    for (let padCol = SUMM_COL_START; padCol <= SUMM_COL_END; padCol++) {
      const pc = ws.getCell(padRow, padCol);
      pc.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F7FB' } };
      pc.border = { top: summBorder, bottom: summBorder, left: summBorder, right: summBorder };
    }
  }

  // ── Row 9: Empty spacer ──────────────────────────────────────
  ws.getRow(9).height = 6;




  // ── Row 10: Column headers (16 cols: A–P) ───────────────────
  // Cols I & K removed: currency now embedded in numFmt of H and I (Выплачено)
  const HDR_ROW = 10;
  ws.getRow(HDR_ROW).height = 40; // extra height for 3-line headers

  const cols: Array<[string, number]> = [
    ['№',                            5],  // A=1
    ['Дата',                        12],  // B=2
    ['Время',                        8],  // C=3
    ['Операция',                    18],  // D=4
    ['Исполнитель',                 16],  // E=5
    ['Счёт',                        18],  // F=6
    ['Вал.\nсчёта',                  8],  // G=7
    ['Сумма',                       18],  // H=8
    ['Курс к USD',                  22],  // I=9 — rate description text (was mislabeled «Выплачено»)
    ['≈ USD',                       14],  // J=10 — numeric USD equivalent (narrowed + center)
    ['Категория',                   20],  // K=11
    ['Группа',                      12],  // L=12
    ['Комментарий',                 32],  // M=13
    ['Остаток\nна счету',           22],  // N=14 — wider for 3 122 213 PLN
    ['Часов работы\n(введите вручную)', 18],  // O=15 — user-input column, explicit label
    ['Ставка/час\n(авторасчёт)',    16],  // P=16 — formula column, explicit label
  ];
  // Header row needs extra height for 2-line labels in O and P
  ws.getRow(HDR_ROW).height = 42;
  cols.forEach(([text, width], i) => hdr(ws, i + 1, HDR_ROW, text, width));

  // Col N=14 «Остаток» header: distinct dark-blue background (stands out as computed column)
  ws.getCell(HDR_ROW, 14).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5276' } };
  // Col O=15 «Часов работы» header: amber tint — explicit user-input column
  ws.getCell(HDR_ROW, 15).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7D6608' } };
  ws.getCell(HDR_ROW, 15).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  // Col P=16 «Ставка/час» header: slightly lighter amber — formula (auto-calculated)
  ws.getCell(HDR_ROW, 16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9E7D09' } };
  ws.getCell(HDR_ROW, 16).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  // Tooltip note on col O: explain user workflow
  ws.getCell(HDR_ROW, 15).note = {
    texts: [{ font: { bold: true, size: 9 }, text: 'Часов работы (O)\n' },
            { font: { size: 8 }, text: 'Введите вручную кол-во часов, потраченных на транзакцию.\n\n' },
            { font: { bold: true, size: 8 }, text: 'Ставка/час (кол. P) = Сумма (H) ÷ Часов (O)\n' },
            { font: { size: 7, italic: true }, text: 'Пример: 10 000 UAH ÷ 8 ч = 1 250 UAH/ч' }],
  };

  // ── Rows 11+: Data ───────────────────────────────────────────
  // USD accumulators for ИТОГО в USD footer row
  let usdGrandTotal = 0;
  let hasUncoveredUsd = false;
  const DATA_START = 11;

  rows.forEach((row, idx) => {
    const rNum = DATA_START + idx;
    const wsRow = ws.getRow(rNum);
    wsRow.height = 18;

    // Row background: income → light green, expense → light red, transfer → light purple, else alternate stripes
    let bgColor: string;
    if (row.transaction_intent === 'income' || row.transaction_intent === 'debt_received') {
      bgColor = 'FFEAFAF1'; // light green
    } else if (row.transaction_intent === 'expense') {
      bgColor = 'FFFDEDEC'; // light red
    } else if (row.transaction_intent === 'transfer') {
      bgColor = 'FFEDE7F6'; // light purple for transfers
    } else {
      const isOdd = idx % 2 === 0;
      bgColor = isOdd ? 'FFFFFFFF' : `FF${C_ROW_ODD}`;
    }

    const txDate   = new Date(row.transaction_time);
    const colour   = intentColour(row.transaction_intent);

    // «Сумма» = фактическое движение по счёту (signed):
    //   income / debt_received → положительное (зачисление)
    //   expense / transfer / debt_given → отрицательное (списание)
    const debitAbs    = parseFloat(row.account_debit_amount ?? row.original_amount);
    const isInflow    = row.transaction_intent === 'income' || row.transaction_intent === 'debt_received';
    const debitSigned = isInflow ? debitAbs : -debitAbs;

    // «Исполнитель»: person_name из БД, иначе эвристика из item_name
    let executor = row.person_name ?? '';
    if (!executor && row.item_name) {
      const words = row.item_name.trim().split(/\s+/);
      const lastCapital = words.reverse().find(w => w.length > 2 && /^[А-ЯA-Z]/.test(w));
      executor = lastCapital ?? '';
    }

    // Currency suffix embedded in numFmt — no separate currency columns needed
    const fmtCur = (cur: string, signed = false): string => {
      const prec = CRYPTO_SET.has(cur.toUpperCase()) ? '########' : '##';
      const p = `#,##0.${prec} "${cur}"`;
      return signed ? `${p};-#,##0.${prec} "${cur}"` : p;
    };

    const cellValues: (string | number | null)[] = [
      idx + 1,                              // ci=0  A=1  №
      fmtDate(txDate),                      // ci=1  B=2  Дата
      fmtTime(txDate),                      // ci=2  C=3  Время
      localiseIntent(row.transaction_intent), // ci=3  D=4  Операция
      executor || '—',                      // ci=4  E=5  Исполнитель
      row.account_name,                     // ci=5  F=6  Счёт
      row.account_currency,                 // ci=6  G=7  Вал.
      debitSigned,                          // ci=7  H=8  Сумма (сигнед; заменяет Сумма+Выплачено)
      null,                                 // ci=8  I=9  Курс к USD — rendered separately
      null,                                 // ci=9  J=10 ≈ USD — rendered separately
      row.category_name,                    // ci=10 K=11 Категория
      row.category_group,                   // ci=11 L=12 Группа
      row.item_name ?? '',                  // ci=12 M=13 Комментарий
      parseFloat(row.balance_after),        // ci=13 N=14 Остаток
    ];


    const dataBorder = {
      top:    { style: 'thin' as const, color: { argb: 'FFD5E8F5' } },
      bottom: { style: 'thin' as const, color: { argb: 'FFD5E8F5' } },
      left:   { style: 'thin' as const, color: { argb: 'FFD5E8F5' } },
      right:  { style: 'thin' as const, color: { argb: 'FFD5E8F5' } },
    };

    cellValues.forEach((val, ci) => {
      const cell = ws.getCell(rNum, ci + 1);
      cell.value = val;
      cell.font = { size: 9, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.border = dataBorder;
      // Alignment by column type
      const horiz =
        (ci === 7 || ci === 13) ? 'right' as const :
        (ci === 0 || ci === 1 || ci === 2 || ci === 6 || ci === 11) ? 'center' as const :
        'left' as const;
      cell.alignment = { vertical: 'middle', horizontal: horiz };
      // D=4 (ci=3): Операция — colour + bold
      if (ci === 3) {
        cell.font = { size: 9, name: 'Calibri', color: { argb: `FF${colour}` }, bold: true };
      }
      // H=8 (ci=7): Сумма — signed, color by sign, numFmt with currency suffix
      if (ci === 7) {
        const sv = val as number;
        cell.numFmt = fmtCur(row.currency, true);
        cell.font = { size: 9, name: 'Calibri',
          color: { argb: sv >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
      }
      // I=9 (ci=8) and J=10 (ci=9): null placeholders — rendered separately below
      if (ci === 8 || ci === 9) { /* skip */ }
      // N=14 (ci=13): Остаток — bold, colour by sign, numFmt with currency suffix
      if (ci === 13) {
        const bal = val as number;
        cell.numFmt = fmtCur(row.account_currency);
        cell.font = { size: 9, name: 'Calibri', bold: true,
          color: { argb: bal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
        cell.fill = { type: 'pattern', pattern: 'solid',
          fgColor: { argb: bal >= 0 ? 'FFE8F8F5' : 'FFFDEDEC' } };
      }
    });

    // Col I=9: «Курс к USD» — descriptive rate text (shown only for cross-currency ops)
    // Rule: if currency === account_currency → same-currency op → show '—' (no conversion)
    //       if currency !== account_currency → cross-currency → show '1 UAH = 0.024 USD'
    const cur = row.currency.toUpperCase();
    const usdRate = usdRates.get(cur) ?? null;
    const isCrossCurrency = row.currency.toUpperCase() !== row.account_currency.toUpperCase();
    const kursCel = ws.getCell(rNum, 9);
    kursCel.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    kursCel.border    = dataBorder;
    kursCel.alignment = { vertical: 'middle', horizontal: 'left' };
    if (!isCrossCurrency) {
      // Same currency op: exchange rate not applicable
      kursCel.value = '';
      kursCel.font  = { size: 8, name: 'Calibri', color: { argb: 'FFCCCCCC' } };
    } else if (['USD', 'USDT', 'USDC', 'BUSD', 'DAI'].includes(cur)) {
      kursCel.value = '1 : 1  (стейблкоин)';
      kursCel.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FF888888' } };
    } else if (usdRate !== null) {
      kursCel.value = `1 ${row.currency} = ${usdRate.toFixed(4).replace(/\.?0+$/, '')} USD`;
      kursCel.font  = { size: 8, name: 'Calibri', color: { argb: 'FF444444' } };
    } else {
      kursCel.value = '— курс н/д';
      kursCel.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FFE67E22' } };
    }

    // Col J=10: «≈ USD» — numeric USD equivalent of this transaction (narrow, center-aligned)
    const usdVal = usdRate !== null ? debitSigned * usdRate : null;
    if (usdVal !== null) usdGrandTotal += usdVal; else hasUncoveredUsd = true;
    const usdCel = ws.getCell(rNum, 10);
    if (usdVal !== null) {
      usdCel.value  = usdVal;
      usdCel.numFmt = '+#,##0.00;-#,##0.00';
      usdCel.font   = { size: 9, name: 'Calibri',
        color: { argb: usdVal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
    } else {
      usdCel.value = '—';
      usdCel.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FFBBBBBB' } };
    }
    usdCel.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    usdCel.border    = dataBorder;
    usdCel.alignment = { vertical: 'middle', horizontal: 'center' };

    // Col O=15: «Часов» — yellow, user input
    const hoursCell = ws.getCell(rNum, 15);
    hoursCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
    hoursCell.border = dataBorder;
    hoursCell.numFmt = '0.00';
    hoursCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // Col P=16: «Ставка/час» — formula =IFERROR(H{n}/O{n},"")
    const rateFCell = ws.getCell(rNum, 16);
    rateFCell.value  = { formula: `IFERROR(H${rNum}/O${rNum},"")` };
    rateFCell.numFmt = '#,##0.00';
    rateFCell.font   = { size: 9, name: 'Calibri', italic: true };
    rateFCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    rateFCell.border = dataBorder;
    rateFCell.alignment = { vertical: 'middle', horizontal: 'right' };
  });

  // ── ИТОГО в USD: navy footer row integrated into the ledger ────────────
  if (rows.length > 0) {
    const footerRow = DATA_START + rows.length;
    ws.getRow(footerRow).height = 24;
    const grandFill   = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_GRAND_BG}` } };
    const grandBorder = {
      top:    { style: 'medium' as const, color: { argb: 'FF0D2840' } },
      bottom: { style: 'medium' as const, color: { argb: 'FF0D2840' } },
    };
    for (let ci = 1; ci <= 16; ci++) {
      ws.getCell(footerRow, ci).fill   = grandFill;
      ws.getCell(footerRow, ci).border = grandBorder;
    }
    // Cols A-I (1-9) merged: label
    ws.mergeCells(footerRow, 1, footerRow, 9);
    const gtLabel = ws.getCell(footerRow, 1);
    gtLabel.value = hasUncoveredUsd ? 'ИТОГО в USD  (часть валют без курса)' : 'ИТОГО в USD';
    gtLabel.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FFB0C8E0' } };
    gtLabel.fill  = grandFill;
    gtLabel.alignment = { horizontal: 'right', vertical: 'middle' };
    // Col J=10: USD grand total
    const usdClr = usdGrandTotal >= 0 ? 'FF7DCEA0' : 'FFE57373';
    const gtJ = ws.getCell(footerRow, 10);
    gtJ.value  = usdGrandTotal;
    gtJ.numFmt = '+#,##0.00;-#,##0.00';
    gtJ.font   = { bold: true, size: 11, name: 'Calibri', color: { argb: usdClr } };
    gtJ.fill   = grandFill;
    gtJ.alignment = { horizontal: 'right', vertical: 'middle' };
  }

  // ── Остатки по счетам на конец периода ──────────────────────
  if (rows.length > 0) {
    const accBRow = DATA_START + rows.length + 2; // +1 footer, +1 blank spacer
    ws.mergeCells(accBRow, 1, accBRow, 16);
    const accHdr = ws.getCell(accBRow, 1);
    accHdr.value = 'ОСТАТКИ ПО СЧЕТАМ НА КОНЕЦ ПЕРИОДА';
    accHdr.font  = { bold: true, size: 9, color: { argb: `FF${C_COL_HDR_FG}` }, name: 'Calibri' };
    accHdr.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_COL_HDR_BG}` } };

    type BalSumm = { currency: string; endBal: string };
    const balMap = new Map<string, BalSumm>();
    for (const row of rows) {
      if (!balMap.has(row.account_name))
        balMap.set(row.account_name, { currency: row.account_currency, endBal: row.balance_after });
    }

    let bRow = accBRow + 1;
    ['Счёт', 'Валюта', 'Остаток'].forEach((h, i) => {
      const c = ws.getCell(bRow, i + 1);
      c.value = h;
      c.font  = { bold: true, size: 8, name: 'Calibri' };
      c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    });
    bRow++;

    for (const [name, { currency, endBal }] of balMap) {
      const balNum = parseFloat(endBal);
      [name, currency, fmtAmtSigned(balNum)].forEach((v, i) => {
        const c = ws.getCell(bRow, i + 1);
        c.value = v;
        c.font  = { size: 9, name: 'Calibri',
          color: balNum < 0 && i === 2 ? { argb: `FF${C_EXPENSE}` } : undefined };
        c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
      });
      bRow++;
    }
  }

  // ── Auto-filter on header row ────────────────────────────────
  ws.autoFilter = { from: { row: HDR_ROW, column: 1 }, to: { row: HDR_ROW, column: 16 } };

  // ── Freeze pane + hide gridlines (enterprise export standard) ──────────────
  // showGridLines: false → document looks like a printed report, not a spreadsheet
  // ySplit: HDR_ROW (=10) → title + summary block + headers always visible on scroll
  ws.views = [{
    state: 'frozen',
    ySplit: HDR_ROW,
    xSplit: 0,
    activeCell: `A${DATA_START}`,
    showGridLines: false,
  }];
}


// ─────────────────────────────────────────────────────────────
// Sheet 2: Счета
// ─────────────────────────────────────────────────────────────

function humaniseAccountType(type: string): string {
  const map: Record<string, string> = {
    manual:   'Наличные',
    cash:     'Наличные',
    bank:     'Банк',
    crypto:   'Крипто',
    exchange: 'Биржа',
    credit:   'Кредитная карта',
    savings:  'Накопления',
    card:     'Карта',
    wallet:   'Кошелёк',
  };
  return map[(type ?? '').toLowerCase()] ?? type;
}

/**
 * Sheet 2 — Asset & Liquidity Dashboard (Wealth Management view)
 *
 * Columns:
 *   A  Счёт              — account name
 *   B  Тип актива        — human-readable type
 *   C  Валюта            — currency code
 *   D  Нач. остаток      — opening balance (CB − net_flow)
 *   E  Оборот (+)        — total inflow this period
 *   F  Оборот (−)        — total outflow this period (displayed positive)
 *   G  Итог. остаток     — closing balance from SQL window function
 *   H  ≈ USD             — closing balance × live rate
 *   I  Доля %            — % of total USD portfolio + native data bar
 *   J  Последняя операция — date of most recent transaction
 *
 * Reconciliation identity: D + E − F = G  (always true by construction)
 */
function buildSheet2(wb: ExcelJS.Workbook, rows: TxRow[], usdRates: Map<string, number>): void {
  const ws = wb.addWorksheet('Счета');
  const TOTAL_COLS = 10;

  // ── Row 1: Title ────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, TOTAL_COLS);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'MIDAS · Asset & Liquidity Dashboard';
  titleCell.font  = { bold: true, size: 13, name: 'Calibri', color: { argb: `FF${C_COL_HDR_FG}` } };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 32;

  // ── Row 2: Column headers ────────────────────────────────────
  const HDR_ROW = 2;
  const colDefs: Array<[string, number]> = [
    ['Счёт',                   24],  // A=1
    ['Тип актива',             16],  // B=2
    ['Вал.',                    8],  // C=3
    ['Нач. остаток',           18],  // D=4
    ['Оборот (+)',             16],  // E=5
    ['Оборот (−)',             16],  // F=6
    ['Итог. остаток',          18],  // G=7
    ['≈ USD',                  15],  // H=8
    ['Доля %',                 14],  // I=9
    ['Последняя\nоперация',    16],  // J=10
  ];
  colDefs.forEach(([text, width], i) => hdr(ws, i + 1, HDR_ROW, text, width));
  ws.getRow(HDR_ROW).height = 30;

  // ── Aggregate per account ────────────────────────────────────
  type AccData = {
    currency:     string;
    accountType:  string;
    inflow:       number;   // income + debt_received
    outflow:      number;   // expense + transfer + debt_given  (stored positive)
    closingBal:   number;   // balance_after of most recent tx (rows sorted DESC)
    lastDate:     Date;
  };
  const accMap = new Map<string, AccData>();

  for (const r of rows) {
    const key    = r.account_name;
    const amt    = parseFloat(r.account_debit_amount ?? r.original_amount);
    const txDate = new Date(r.transaction_time);
    const isIn   = r.transaction_intent === 'income' || r.transaction_intent === 'debt_received';

    if (!accMap.has(key)) {
      // First encounter = most recent tx (rows DESC) → take balance_after as closing balance
      accMap.set(key, {
        currency:    r.account_currency,
        accountType: r.account_type,
        inflow:      0,
        outflow:     0,
        closingBal:  parseFloat(r.balance_after),
        lastDate:    txDate,
      });
    }
    const acc = accMap.get(key)!;
    if (isIn) acc.inflow  += amt;
    else      acc.outflow += amt;
    // lastDate: keep the most recent (rows are DESC so first encountered = most recent)
    if (txDate > acc.lastDate) acc.lastDate = txDate;
  }

  // ── Compute USD equivalents & portfolio total ─────────────────
  type AccRow = AccData & {
    name:         string;
    openingBal:   number;
    usdEquiv:     number | null;
    portfolioPct: number;   // filled after total known
  };

  const accRows: AccRow[] = [];
  let totalUsd = 0;

  for (const [name, acc] of accMap) {
    const openingBal  = acc.closingBal - acc.inflow + acc.outflow;
    const rate        = usdRates.get(acc.currency.toUpperCase()) ?? null;
    const usdEquiv    = rate !== null ? acc.closingBal * rate : null;
    if (usdEquiv !== null) totalUsd += usdEquiv;
    accRows.push({ ...acc, name, openingBal, usdEquiv, portfolioPct: 0 });
  }

  // Fill portfolio %
  for (const ar of accRows) {
    ar.portfolioPct = totalUsd > 0 && ar.usdEquiv !== null
      ? (ar.usdEquiv / totalUsd) * 100
      : 0;
  }

  // Sort descending by USD equivalent (largest holding first)
  accRows.sort((a, b) => (b.usdEquiv ?? -Infinity) - (a.usdEquiv ?? -Infinity));

  // ── Data rows ────────────────────────────────────────────────
  const DATA_START = 3;
  const thinBorder = {
    top:    { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    bottom: { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    left:   { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };

  let rn = DATA_START;
  for (const ar of accRows) {
    const bgColor = rn % 2 === 0 ? `FF${C_ROW_ODD}` : 'FFFFFFFF';
    const fillBg  = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgColor } };
    const nf      = smartNumFmt(ar.currency);

    ws.getRow(rn).height = 20;

    // A — Account name
    const ca = ws.getCell(rn, 1);
    ca.value = ar.name;
    ca.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF1A3C5E' } };
    ca.fill  = fillBg; ca.border = thinBorder;
    ca.alignment = { vertical: 'middle', horizontal: 'left' };

    // B — Asset type (human-readable)
    const cb = ws.getCell(rn, 2);
    cb.value = humaniseAccountType(ar.accountType);
    cb.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FF555555' } };
    cb.fill  = fillBg; cb.border = thinBorder;
    cb.alignment = { vertical: 'middle', horizontal: 'left' };

    // C — Currency
    const cc = ws.getCell(rn, 3);
    cc.value = ar.currency;
    cc.font  = { size: 9, name: 'Calibri', color: { argb: 'FF444444' } };
    cc.fill  = fillBg; cc.border = thinBorder;
    cc.alignment = { vertical: 'middle', horizontal: 'center' };

    // D — Opening balance
    const cd = ws.getCell(rn, 4);
    cd.value  = ar.openingBal;
    cd.numFmt = nf;
    cd.font   = { size: 9, name: 'Calibri',
      color: { argb: ar.openingBal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
    cd.fill  = fillBg; cd.border = thinBorder;
    cd.alignment = { vertical: 'middle', horizontal: 'right' };

    // E — Inflow (+)
    const ce = ws.getCell(rn, 5);
    ce.value  = ar.inflow;
    ce.numFmt = nf;
    ce.font   = { size: 9, name: 'Calibri', color: { argb: `FF${C_INCOME}` } };
    ce.fill  = fillBg; ce.border = thinBorder;
    ce.alignment = { vertical: 'middle', horizontal: 'right' };

    // F — Outflow (−), stored positive, displayed with minus color
    const cf = ws.getCell(rn, 6);
    cf.value  = ar.outflow;
    cf.numFmt = nf;
    cf.font   = { size: 9, name: 'Calibri', color: { argb: `FF${C_EXPENSE}` } };
    cf.fill  = fillBg; cf.border = thinBorder;
    cf.alignment = { vertical: 'middle', horizontal: 'right' };

    // G — Closing balance (from SQL window fn — ground truth)
    const cg = ws.getCell(rn, 7);
    cg.value  = ar.closingBal;
    cg.numFmt = nf;
    cg.font   = { bold: true, size: 9, name: 'Calibri',
      color: { argb: ar.closingBal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
    cg.fill   = { type: 'pattern', pattern: 'solid',
      fgColor: { argb: ar.closingBal >= 0 ? 'FFE8F8F5' : 'FFFDEDEC' } };
    cg.border = thinBorder;
    cg.alignment = { vertical: 'middle', horizontal: 'right' };

    // H — ≈ USD equivalent
    const ch = ws.getCell(rn, 8);
    if (ar.usdEquiv !== null) {
      ch.value  = ar.usdEquiv;
      ch.numFmt = '#,##0.00';
      ch.font   = { bold: true, size: 9, name: 'Calibri',
        color: { argb: ar.usdEquiv >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
    } else {
      ch.value = '— н/д';
      ch.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FFAAAAAA' } };
    }
    ch.fill  = fillBg; ch.border = thinBorder;
    ch.alignment = { vertical: 'middle', horizontal: 'right' };

    // I — Portfolio % (numeric for data bar)
    const ci = ws.getCell(rn, 9);
    ci.value  = parseFloat(ar.portfolioPct.toFixed(2));
    ci.numFmt = '0.00"%"';
    ci.font   = { size: 9, name: 'Calibri', color: { argb: 'FF2D6A9F' } };
    ci.fill  = fillBg; ci.border = thinBorder;
    ci.alignment = { vertical: 'middle', horizontal: 'right' };

    // J — Last activity date
    const cj = ws.getCell(rn, 10);
    cj.value = fmtDate(ar.lastDate);
    cj.font  = { size: 8, name: 'Calibri', color: { argb: 'FF666666' } };
    cj.fill  = fillBg; cj.border = thinBorder;
    cj.alignment = { vertical: 'middle', horizontal: 'center' };

    rn++;
  }

  // ── Native Data Bar (conditional formatting) on Portfolio % col ─
  // Renders visual bar inside cell I — like Bloomberg/Xero KPI column
  if (accRows.length > 0) {
    const pctRef = `I${DATA_START}:I${rn - 1}`;
    ws.addConditionalFormatting({
      ref: pctRef,
      rules: [{
        type:      'dataBar',
        priority:  1,
        minLength: 0,
        maxLength: 100,
        showValue: true,
        gradient:  false,
        cfvo: [
          { type: 'num', value: 0 },
          { type: 'num', value: 100 },
        ],
      }],
    });
  }

  // ── Net Worth footer row ─────────────────────────────────────
  // Navy bookend: mirrors Grand Total row on Sheet0/Sheet1
  const footerRow = rn;
  ws.getRow(footerRow).height = 24;
  const gtFill   = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_GRAND_BG}` } };
  const gtBorder = {
    top:    { style: 'medium' as const, color: { argb: 'FF0D2840' } },
    bottom: { style: 'medium' as const, color: { argb: 'FF0D2840' } },
    left:   { style: 'thin'   as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin'   as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };
  for (let ci = 1; ci <= TOTAL_COLS; ci++) {
    ws.getCell(footerRow, ci).fill   = gtFill;
    ws.getCell(footerRow, ci).border = gtBorder;
  }
  // Label: cols A–G merged
  ws.mergeCells(footerRow, 1, footerRow, 7);
  const gtLabel = ws.getCell(footerRow, 1);
  gtLabel.value = 'ИТОГО · Net Worth';
  gtLabel.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: 'FFB0C8E0' } };
  gtLabel.fill  = gtFill;
  gtLabel.alignment = { horizontal: 'right', vertical: 'middle' };

  // Col H — Total USD
  const totalClr = totalUsd >= 0 ? 'FF7DCEA0' : 'FFE57373';
  const gtH = ws.getCell(footerRow, 8);
  gtH.value  = totalUsd;
  gtH.numFmt = '#,##0.00';
  gtH.font   = { bold: true, size: 11, name: 'Calibri', color: { argb: totalClr } };
  gtH.fill   = gtFill;
  gtH.alignment = { horizontal: 'right', vertical: 'middle' };

  // Col I — always 100%
  const gtI = ws.getCell(footerRow, 9);
  gtI.value  = '100%';
  gtI.font   = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FFB0C8E0' } };
  gtI.fill   = gtFill;
  gtI.alignment = { horizontal: 'right', vertical: 'middle' };

  // ── Footnote ─────────────────────────────────────────────────
  const fnRow = footerRow + 1;
  ws.mergeCells(fnRow, 1, fnRow, TOTAL_COLS);
  const fn = ws.getCell(fnRow, 1);
  fn.value = 'Курс на дату экспорта · open.er-api.com (fiat) · mexc.com (crypto) · Reconciliation: Нач. остаток + Оборот(+) − Оборот(−) = Итог. остаток';
  fn.font  = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
  fn.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
  fn.border = { top: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
  ws.getRow(fnRow).height = 14;

  // ── Freeze + hide gridlines ───────────────────────────────────
  ws.views = [{
    state: 'frozen',
    ySplit: HDR_ROW,
    xSplit: 0,
    activeCell: `A${DATA_START}`,
    showGridLines: false,
  }];
  ws.properties.tabColor = { argb: `FF${C_COL_HDR_BG}` };
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
