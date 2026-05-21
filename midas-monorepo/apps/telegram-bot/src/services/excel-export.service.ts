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

/** Extended: shows transfer direction if paired */
function localiseIntentWithDir(intent: string, direction: string | null): string {
  if (intent === 'transfer' && direction === 'outbound') return '🔄 Перевод (исход)';
  if (intent === 'transfer' && direction === 'inbound')  return '🔄 Перевод (приход)';
  return localiseIntent(intent);
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
  transfer_direction: string | null;  // 'inbound' | 'outbound' | null
  transfer_group_id: string | null;   // UUID linking paired transfer legs
  paired_account_name: string | null; // name of the other account in internal transfer
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
           t.transfer_direction,
           t.transfer_group_id,
           CASE
             WHEN t.transaction_intent IN ('income', 'debt_received')
               THEN  COALESCE(t.account_debit_amount, t.original_amount)
             WHEN t.transaction_intent = 'transfer' AND t.transfer_direction = 'inbound'
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
         ROUND(wb.balance_after, 2)::text AS balance_after,
         wb.transfer_direction,
         wb.transfer_group_id::text,
         -- Paired account name: find the OTHER leg of the same transfer_group_id
         (SELECT a2.name
          FROM transactions t2
          JOIN account_sources a2 ON a2.id = t2.account_id AND a2.deleted_at IS NULL
          WHERE t2.transfer_group_id = wb.transfer_group_id
            AND t2.id != wb.id
            AND t2.workspace_id = wb.workspace_id
            AND t2.deleted_at IS NULL
          LIMIT 1) AS paired_account_name
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
  buildSheet3(wb, rows, usdRates);
  buildSheet4(wb, rows, from, to, usdRates);

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
  ws.getColumn(5).width = 44; // Все расходы — widened to prevent truncation

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
  title.value = `MIDAS — Финансовый отчёт  ·  ${periodStr}`;
  title.font = { bold: true, size: 13, color: { argb: `FF${C_COL_HDR_FG}` }, name: 'Calibri' };
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
  // (no extra spacer — meta rows flow directly into first section)

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
  // Separate signed transfer accumulator: outbound=negative, inbound=positive
  // This ensures paired internal transfers net to 0
  const transferSigned = new Map<string, number>(); // by currency, signed
  // Track seen transfer groups to count paired transfers as 1 operation (not 2)
  const seenTransferGroups = new Set<string>();
  for (const row of rows) {
    const key = row.transaction_intent as IntentKey;
    if (!(key in im)) continue;

    if (key === 'transfer') {
      // Count: paired transfers count as 1 op (enterprise standard)
      if (row.transfer_group_id && row.transfer_direction) {
        if (!seenTransferGroups.has(row.transfer_group_id)) {
          seenTransferGroups.add(row.transfer_group_id);
          im[key].count++;
        }
      } else {
        // Unpaired transfer — count normally
        im[key].count++;
      }
      const amt = parseFloat(row.original_amount);
      // For the display row, we still accumulate absolute amounts
      im[key].byCur.set(row.currency, (im[key].byCur.get(row.currency) ?? 0) + amt);
      // For the NET calc, accumulate signed (outbound=−, inbound=+, unpaired=−)
      const sign = row.transfer_direction === 'inbound' ? 1 : -1;
      transferSigned.set(row.currency, (transferSigned.get(row.currency) ?? 0) + sign * amt);
    } else {
      im[key].count++;
      const amt = parseFloat(row.original_amount);
      im[key].byCur.set(row.currency, (im[key].byCur.get(row.currency) ?? 0) + amt);
    }
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

  // ── Net per currency (income + debtRecv − expense − transfer(signed) − debtGiven) ──
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
    // Use signed transfer amounts: paired internal transfers net to 0,
    // unpaired external transfers remain negative
    const net =
      (im.income.byCur.get(cur) ?? 0) +
      (im.debt_received.byCur.get(cur) ?? 0) -
      (im.expense.byCur.get(cur) ?? 0) +
      (transferSigned.get(cur) ?? 0) -   // already signed (negative for outbound, positive for inbound)
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
  r++; r++; // spacer

  // ── Section: Движение капитала ─────────────────────────────
  {
    // Calculate internal vs external transfer totals
    const internalOutbound: Map<string, number> = new Map(); // by currency
    const internalInbound:  Map<string, number> = new Map();
    let externalTotal = 0;      // USD total for external transfers (unpaired)
    let externalCount = 0;

    for (const row of rows) {
      if (row.transaction_intent !== 'transfer') continue;
      const amt = parseFloat(row.account_debit_amount ?? row.original_amount);
      const cur = row.currency;

      if (row.transfer_direction === 'outbound') {
        internalOutbound.set(cur, (internalOutbound.get(cur) ?? 0) + amt);
      } else if (row.transfer_direction === 'inbound') {
        internalInbound.set(cur, (internalInbound.get(cur) ?? 0) + amt);
      } else {
        // Unpaired transfer = external (no direction)
        const rate = usdRates.get(cur.toUpperCase()) ?? 0;
        externalTotal += amt * rate;
        externalCount++;
      }
    }

    const hasInternalTransfers = internalOutbound.size > 0 || internalInbound.size > 0;
    const hasExternalTransfers = externalCount > 0;

    if (hasInternalTransfers || hasExternalTransfers) {
      // Section header
      ws.mergeCells(r, 1, r, 5);
      const cmHdr = ws.getCell(r, 1);
      cmHdr.value = '🔄  ДВИЖЕНИЕ КАПИТАЛА';
      cmHdr.font  = { bold: true, size: 11, color: { argb: `FF${C_COL_HDR_FG}` }, name: 'Calibri' };
      cmHdr.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B1FA2' } }; // purple
      cmHdr.alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(r).height = 24;
      r++;

      // Sub-header
      const cmSubBorder = {
        bottom: { style: 'thin' as const, color: { argb: 'FFD1C4E9' } },
      };
      const cmSubFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF3E5F5' } };

      if (hasInternalTransfers) {
        ws.mergeCells(r, 1, r, 3);
        const intHdr = ws.getCell(r, 1);
        intHdr.value = '🏦  Внутренние переводы (между своими счетами)';
        intHdr.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF4A148C' } };
        intHdr.fill  = cmSubFill;
        intHdr.border = cmSubBorder;
        ws.mergeCells(r, 4, r, 5);
        const intNet = ws.getCell(r, 4);
        intNet.value = 'Нетто: 0 (не влияет на P&L)';
        intNet.font  = { size: 9, name: 'Calibri', italic: true, color: { argb: 'FF888888' } };
        intNet.fill  = cmSubFill;
        intNet.border = cmSubBorder;
        intNet.alignment = { horizontal: 'right', vertical: 'middle' };
        ws.getRow(r).height = 20;
        r++;

        // Detail rows per currency
        for (const [cur, outAmt] of internalOutbound) {
          const inAmt = internalInbound.get(cur) ?? 0;
          ws.getCell(r, 1).value = '    ';
          ws.getCell(r, 2).value = cur;
          ws.getCell(r, 2).font = { size: 9, name: 'Calibri', bold: true };
          ws.mergeCells(r, 3, r, 4);
          ws.getCell(r, 3).value = `📤 −${outAmt.toFixed(2)}  ⟷  📥 +${inAmt.toFixed(2)}`;
          ws.getCell(r, 3).font = { size: 9, name: 'Calibri', color: { argb: 'FF555555' } };
          ws.getCell(r, 3).alignment = { horizontal: 'center', vertical: 'middle' };
          ws.getRow(r).height = 17;
          r++;
        }
        r++; // spacer
      }

      if (hasExternalTransfers) {
        ws.mergeCells(r, 1, r, 3);
        const extHdr = ws.getCell(r, 1);
        extHdr.value = '👤  Переводы другим (расход)';
        extHdr.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: `FF${C_EXPENSE}` } };
        extHdr.fill  = cmSubFill;
        extHdr.border = cmSubBorder;
        ws.mergeCells(r, 4, r, 5);
        const extVal = ws.getCell(r, 4);
        extVal.value = `≈ −${externalTotal.toFixed(2)} USD  (${externalCount} оп.)`;
        extVal.font  = { size: 9, name: 'Calibri', color: { argb: `FF${C_EXPENSE}` } };
        extVal.fill  = cmSubFill;
        extVal.border = cmSubBorder;
        extVal.alignment = { horizontal: 'right', vertical: 'middle' };
        ws.getRow(r).height = 20;
        r++;
      }

      r++; // spacer after section
    }
  }

  r++; r++; // spacer before footer

  // ── Audit Trail Footer ────────────────────────────────────
  // Styled block with top border — not a floating text dump
  r++; // spacer
  const ftBorder = {
    top:   { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    left:  { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right: { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };
  const ftBorderBot = {
    ...ftBorder,
    bottom: { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };
  const ftFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_TOTAL_BG}` } };
  const footerLine = (row: number, val: string, isLast = false) => {
    ws.mergeCells(row, 1, row, 5);
    const c = ws.getCell(row, 1);
    c.value = val;
    c.font  = { size: 8, italic: true, color: { argb: 'FF666666' }, name: 'Calibri' };
    c.fill  = ftFill;
    c.border = isLast ? ftBorderBot : ftBorder;
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(row).height = 16;
    return c;
  };
  footerLine(r, `📋 Документ сформирован системой MIDAS v2.0  ·  ${fmtDate(new Date())} ${fmtTime(new Date())}`); r++;
  footerLine(r, `📅 Период: ${periodStr}  ·  Количество записей: ${String(rows.length)}`); r++;
  footerLine(r, 'ℹ️ Документ является информационным. Для официального подтверждения операций обратитесь в банк или платёжную систему.', true); r++;

  // Freeze row 1 + hide gridlines (matches enterprise standard of all other sheets)
  ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2', showGridLines: false }];
  ws.properties.tabColor = { argb: `FF${C_HEADER_BG}` };
}

// ─────────────────────────────────────────────────────────────
// Sheet 1: Транзакции
// ─────────────────────────────────────────────────────────────

function buildSheet1(wb: ExcelJS.Workbook, rows: TxRow[], from: Date, to: Date, usdRates: Map<string, number>): void {
  // ── Pre-process: merge paired transfers into single display rows ──────
  // Enterprise standard (Revolut/Wise/YNAB/Tinkoff): one transfer = one row.
  // Paired transfers (linked by transfer_group_id) are collapsed into a single
  // row showing: source → target account, amount, and cross-currency conversion.
  type DisplayRow = TxRow & {
    _merged?: boolean;
    _targetAccount?: string;
    _targetCurrency?: string;
    _targetAmount?: number;
    _targetBalanceAfter?: string;
  };

  const transferPairs = new Map<string, { outbound?: TxRow; inbound?: TxRow }>();
  const nonTransferRows: DisplayRow[] = [];

  for (const row of rows) {
    if (row.transfer_group_id && row.transfer_direction) {
      const gid = row.transfer_group_id;
      if (!transferPairs.has(gid)) transferPairs.set(gid, {});
      const pair = transferPairs.get(gid)!;
      if (row.transfer_direction === 'outbound') pair.outbound = row;
      else if (row.transfer_direction === 'inbound') pair.inbound = row;
    } else {
      nonTransferRows.push(row);
    }
  }

  const mergedTransfers: DisplayRow[] = [];
  const unpairedTransfers: DisplayRow[] = [];

  for (const [, pair] of transferPairs) {
    if (pair.outbound && pair.inbound) {
      // Full pair — merge into single row based on outbound leg
      const merged: DisplayRow = {
        ...pair.outbound,
        _merged: true,
        _targetAccount: pair.inbound.account_name,
        _targetCurrency: pair.inbound.account_currency,
        _targetAmount: parseFloat(pair.inbound.account_debit_amount ?? pair.inbound.original_amount),
        _targetBalanceAfter: pair.inbound.balance_after,
        transfer_direction: null, // plain "Перевод" label (no direction)
      };
      mergedTransfers.push(merged);
    } else {
      // Unpaired (orphaned leg) — keep as-is
      if (pair.outbound) unpairedTransfers.push(pair.outbound);
      if (pair.inbound) unpairedTransfers.push(pair.inbound);
    }
  }

  // Combine all rows and re-sort by transaction_time DESC (same as SQL)
  const displayRows: DisplayRow[] = [
    ...nonTransferRows,
    ...mergedTransfers,
    ...unpairedTransfers,
  ].sort((a, b) => new Date(b.transaction_time).getTime() - new Date(a.transaction_time).getTime());

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

  // ── Row 2: Statement meta (ops count + generation date) ───────
  const metaRow = 2;
  ws.mergeCells(metaRow, 1, metaRow, 16);
  const metaCell = ws.getCell(metaRow, 1);
  metaCell.value = `${displayRows.length} операций  ·  Сгенерировано: ${fmtDate(new Date())} ${fmtTime(new Date())}`;
  metaCell.font  = { size: 9, name: 'Calibri', italic: true, color: { argb: 'FFB0C8E0' } };
  metaCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(metaRow).height = 20;

  // ── Row 3: Spacer ──────────────────────────────────────────────
  ws.getRow(3).height = 4;

  // ── Row 4: Column headers (16 cols: A–P) ───────────────────
  const HDR_ROW = 4;
  ws.getRow(HDR_ROW).height = 42;

  const cols: Array<[string, number]> = [
    ['№',                            5],  // A=1
    ['Дата',                        12],  // B=2
    ['Время',                        8],  // C=3
    ['Операция',                    18],  // D=4
    ['Исполнитель',                 16],  // E=5
    ['Счёт',                        18],  // F=6
    ['Вал.\nсчёта',                  8],  // G=7
    ['Сумма',                       18],  // H=8
    ['Курс к USD',                  28],  // I=9 — widened for rate text
    ['≈ USD',                       14],  // J=10
    ['Категория',                   20],  // K=11
    ['Группа',                      12],  // L=12
    ['Комментарий',                 32],  // M=13
    ['Остаток\nна счету',           22],  // N=14
    ['Часов работы\n(введите вручную)', 18],  // O=15
    ['Ставка/час\n(авторасчёт)',    16],  // P=16
  ];
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
  const DATA_START = HDR_ROW + 1;  // = 5

  displayRows.forEach((row, idx) => {
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
    //   income / debt_received / transfer inbound → положительное (зачисление)
    //   expense / transfer outbound / debt_given → отрицательное (списание)
    const debitAbs    = parseFloat(row.account_debit_amount ?? row.original_amount);
    const isInflow    = row.transaction_intent === 'income'
                     || row.transaction_intent === 'debt_received'
                     || (row.transaction_intent === 'transfer' && row.transfer_direction === 'inbound');
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

    // «Комментарий»: display varies by transfer type
    let comment = row.item_name ?? '';
    if (row._merged) {
      // Merged transfer: show cross-currency conversion if applicable
      if (row._targetCurrency && row._targetCurrency !== row.account_currency) {
        const srcAmt = debitAbs;
        const tgtAmt = row._targetAmount ?? 0;
        const srcFmt = srcAmt % 1 === 0 ? String(srcAmt) : srcAmt.toFixed(2);
        const tgtFmt = tgtAmt % 1 === 0 ? String(tgtAmt) : tgtAmt.toFixed(2);
        const xfxNote = `${srcFmt} ${row.currency} → ${tgtFmt} ${row._targetCurrency}`;
        comment = comment ? `${xfxNote}  |  ${comment}` : xfxNote;
      }
    } else if (row.transaction_intent === 'transfer' && row.paired_account_name) {
      const arrow = row.transfer_direction === 'outbound' ? '→' : '←';
      const pairedLabel = `${arrow} ${row.paired_account_name}`;
      comment = comment ? `${pairedLabel}  |  ${comment}` : pairedLabel;
    }

    // ── Display values: merged transfer overrides ──
    const displayOp = row._merged
      ? '🔄 Перевод'
      : localiseIntentWithDir(row.transaction_intent, row.transfer_direction);
    const displayAccount = row._merged
      ? `${row.account_name} → ${row._targetAccount}`
      : row.account_name;
    const displayCurrency = row._merged && row._targetCurrency && row._targetCurrency !== row.account_currency
      ? `${row.account_currency} → ${row._targetCurrency}`
      : row.account_currency;
    const displayAmount = row._merged ? debitAbs : debitSigned;

    const cellValues: (string | number | null)[] = [
      idx + 1,                              // ci=0  A=1  №
      fmtDate(txDate),                      // ci=1  B=2  Дата
      fmtTime(txDate),                      // ci=2  C=3  Время
      displayOp,                            // ci=3  D=4  Операция
      executor || '—',                      // ci=4  E=5  Исполнитель
      displayAccount,                       // ci=5  F=6  Счёт (merged: "Visa → Binance")
      displayCurrency,                      // ci=6  G=7  Вал. (merged cross-ccy: "USD → USDT")
      displayAmount,                        // ci=7  H=8  Сумма (merged: absolute; others: signed)
      null,                                 // ci=8  I=9  Курс к USD — rendered separately
      null,                                 // ci=9  J=10 ≈ USD — rendered separately
      row.category_name,                    // ci=10 K=11 Категория
      row.category_group,                   // ci=11 L=12 Группа
      comment,                              // ci=12 M=13 Комментарий
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
      // H=8 (ci=7): Сумма — color-coded by intent
      if (ci === 7) {
        const sv = val as number;
        if (row._merged) {
          // Merged transfer: absolute amount, neutral purple — not income nor expense
          cell.numFmt = fmtCur(row.currency, false);
          cell.font = { size: 9, name: 'Calibri', color: { argb: 'FF7B68EE' } };
        } else {
          cell.numFmt = fmtCur(row.currency, true);
          cell.font = { size: 9, name: 'Calibri',
            color: { argb: sv >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
        }
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

    // Col I=9: «Курс к USD» — show rate for ALL non-stablecoin currencies
    const cur = row.currency.toUpperCase();
    const usdRate = usdRates.get(cur) ?? null;
    const kursCel = ws.getCell(rNum, 9);
    kursCel.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    kursCel.border    = dataBorder;
    kursCel.alignment = { vertical: 'middle', horizontal: 'left' };
    const STABLECOINS = ['USD', 'USDT', 'USDC', 'BUSD', 'DAI'];
    if (STABLECOINS.includes(cur)) {
      kursCel.value = '1 : 1  (стейблкоин)';
      kursCel.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FF888888' } };
    } else if (usdRate !== null) {
      kursCel.value = `1 ${row.currency} = ${usdRate.toFixed(4).replace(/\.?0+$/, '')} USD`;
      kursCel.font  = { size: 8, name: 'Calibri', color: { argb: 'FF444444' } };
    } else {
      kursCel.value = '— курс н/д';
      kursCel.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FFE67E22' } };
    }

    // Col J=10: «≈ USD» — numeric USD equivalent of this transaction
    const usdCel = ws.getCell(rNum, 10);
    if (row._merged) {
      // Internal transfer: net USD impact = 0 — show dash, skip grand total
      usdCel.value = '—';
      usdCel.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FFBBBBBB' } };
    } else {
      const usdVal = usdRate !== null ? debitSigned * usdRate : null;
      if (usdVal !== null) usdGrandTotal += usdVal; else hasUncoveredUsd = true;
      if (usdVal !== null) {
        usdCel.value  = usdVal;
        usdCel.numFmt = '+#,##0.00;-#,##0.00';
        usdCel.font   = { size: 9, name: 'Calibri',
          color: { argb: usdVal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
      } else {
        usdCel.value = '—';
        usdCel.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FFBBBBBB' } };
      }
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
  if (displayRows.length > 0) {
    const footerRow = DATA_START + displayRows.length;
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

  // ── Premium Closing Balances Widget ──────────────────────────
  if (displayRows.length > 0) {
    const gapRow  = DATA_START + displayRows.length + 1;  // after ИТОГО footer row
    const wStart  = gapRow + 1; // spacer row above widget
    ws.getRow(gapRow).height = 6;

    // Widget header (navy)
    ws.mergeCells(wStart, 1, wStart, 6);
    const wHdr = ws.getCell(wStart, 1);
    wHdr.value = 'ОСТАТКИ НА КОНЕЦ ПЕРИОДА';
    wHdr.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: `FF${C_COL_HDR_FG}` } };
    wHdr.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
    wHdr.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(wStart).height = 24;
    for (let ci = 1; ci <= 6; ci++) {
      ws.getCell(wStart, ci).fill = wHdr.fill;
      ws.getCell(wStart, ci).border = {
        bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } },
      };
    }

    // Widget sub-header
    const wSubRow = wStart + 1;
    const wSubHdrs = ['Счёт', 'Валюта', 'Остаток', '≈ USD', '', ''];
    const wSubWidths = [24, 10, 18, 18, 0, 0];
    wSubHdrs.forEach((h, i) => {
      const c = ws.getCell(wSubRow, i + 1);
      c.value = h;
      c.font  = { bold: true, size: 8, name: 'Calibri', color: { argb: 'FF2D6A9F' } };
      c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_TOTAL_HDR}` } };
      c.alignment = { horizontal: i >= 2 ? 'right' : 'left', vertical: 'middle' };
      c.border = { bottom: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
      if (wSubWidths[i]) ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width ?? 0, wSubWidths[i]);
    });
    ws.getRow(wSubRow).height = 18;

    // Widget data rows
    type BalSumm = { currency: string; endBal: number };
    const balMap = new Map<string, BalSumm>();
    for (const row of rows) {
      if (!balMap.has(row.account_name))
        balMap.set(row.account_name, { currency: row.account_currency, endBal: parseFloat(row.balance_after) });
    }

    let wRow = wSubRow + 1;
    let netWorthUsd = 0;
    const wBorder = {
      top:    { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
      bottom: { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
      left:   { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
      right:  { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    };

    for (const [name, { currency, endBal }] of balMap) {
      const bgArgb = wRow % 2 === 0 ? `FF${C_ROW_ODD}` : 'FFFFFFFF';
      const fillBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgArgb } };
      const balClr = endBal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`;
      ws.getRow(wRow).height = 18;

      // Col A: Account name
      const c1 = ws.getCell(wRow, 1);
      c1.value = name; c1.font = { size: 9, name: 'Calibri', bold: true, color: { argb: 'FF1A3C5E' } };
      c1.fill = fillBg; c1.border = wBorder; c1.alignment = { vertical: 'middle' };
      // Col B: Currency
      const c2 = ws.getCell(wRow, 2);
      c2.value = currency; c2.font = { size: 9, name: 'Calibri' };
      c2.fill = fillBg; c2.border = wBorder; c2.alignment = { horizontal: 'center', vertical: 'middle' };
      // Col C: Balance (native currency)
      const c3 = ws.getCell(wRow, 3);
      c3.value = endBal; c3.numFmt = '+#,##0.00;-#,##0.00';
      c3.font  = { size: 9, name: 'Calibri', bold: true, color: { argb: balClr } };
      c3.fill = fillBg; c3.border = wBorder; c3.alignment = { horizontal: 'right', vertical: 'middle' };
      // Col D: ≈ USD
      const rate = usdRates.get(currency.toUpperCase()) ?? null;
      const balUsd = rate !== null ? endBal * rate : null;
      if (balUsd !== null) netWorthUsd += balUsd;
      const c4 = ws.getCell(wRow, 4);
      if (balUsd !== null) {
        c4.value = balUsd; c4.numFmt = '+#,##0.00;-#,##0.00';
        c4.font  = { size: 9, name: 'Calibri', color: { argb: balUsd >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
      } else {
        c4.value = '—'; c4.font = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FFBBBBBB' } };
      }
      c4.fill = fillBg; c4.border = wBorder; c4.alignment = { horizontal: 'right', vertical: 'middle' };

      wRow++;
    }

    // Net Worth total row
    const nwFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_GRAND_BG}` } };
    const nwBorder = {
      top: { style: 'medium' as const, color: { argb: 'FF0D2840' } },
      bottom: { style: 'medium' as const, color: { argb: 'FF0D2840' } },
      left:   { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
      right:  { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    };
    ws.getRow(wRow).height = 22;
    ws.mergeCells(wRow, 1, wRow, 3);
    const nw1 = ws.getCell(wRow, 1);
    nw1.value = 'Net Worth ≈ USD';
    nw1.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: 'FFB0C8E0' } };
    nw1.fill  = nwFill; nw1.border = nwBorder;
    nw1.alignment = { horizontal: 'right', vertical: 'middle' };
    const nwClr = netWorthUsd >= 0 ? 'FF7DCEA0' : 'FFE57373';
    const nw4 = ws.getCell(wRow, 4);
    nw4.value = netWorthUsd; nw4.numFmt = '+#,##0.00;-#,##0.00';
    nw4.font  = { bold: true, size: 11, name: 'Calibri', color: { argb: nwClr } };
    nw4.fill  = nwFill; nw4.border = nwBorder;
    nw4.alignment = { horizontal: 'right', vertical: 'middle' };
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

function classifyAccount(cur: string, bal: number): string {
  if (bal < 0) return 'Кредит / Овердрафт';
  if (CRYPTO_SET.has(cur.toUpperCase())) return 'Крипто активы';
  return 'Банки и наличные';
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

  for (const [name, acc] of accMap) {
    const openingBal  = acc.closingBal - acc.inflow + acc.outflow;
    const rate        = usdRates.get(acc.currency.toUpperCase()) ?? null;
    const usdEquiv    = rate !== null ? acc.closingBal * rate : null;
    accRows.push({ ...acc, name, openingBal, usdEquiv, portfolioPct: 0 });
  }

  // ── GAAP split: Assets (≥0) vs Liabilities (<0) ──────────────
  const assetRows = accRows.filter(a => (a.usdEquiv ?? a.closingBal) >= 0);
  const liabRows  = accRows.filter(a => (a.usdEquiv ?? a.closingBal) < 0);

  const totalAssetUsd = assetRows.reduce((s, a) => s + (a.usdEquiv ?? 0), 0);
  const totalLiabUsd  = liabRows.reduce((s, a) => s + Math.abs(a.usdEquiv ?? 0), 0);
  const netWorthUsd   = totalAssetUsd - totalLiabUsd;

  // Allocation % within each class
  for (const ar of assetRows) {
    ar.portfolioPct = totalAssetUsd > 0 && ar.usdEquiv !== null
      ? (ar.usdEquiv / totalAssetUsd) * 100 : 0;
  }
  for (const ar of liabRows) {
    ar.portfolioPct = totalLiabUsd > 0 && ar.usdEquiv !== null
      ? (Math.abs(ar.usdEquiv) / totalLiabUsd) * 100 : 0;
  }

  // Sort within each class: assets DESC, liabilities by absolute DESC
  assetRows.sort((a, b) => (b.usdEquiv ?? -Infinity) - (a.usdEquiv ?? -Infinity));
  liabRows.sort((a, b) => Math.abs(b.usdEquiv ?? 0) - Math.abs(a.usdEquiv ?? 0));

  // ── Rendering helpers ────────────────────────────────────────
  const DATA_START = 3;
  const thinBorder = {
    top:    { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    bottom: { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    left:   { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };

  let rn = DATA_START;

  // Render a single account data row
  const renderAccRow = (ar: AccRow, bgArgb: string) => {
    const fillBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgArgb } };
    const nf = smartNumFmt(ar.currency);
    ws.getRow(rn).height = 20;

    const ca = ws.getCell(rn, 1);
    ca.value = ar.name;
    ca.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF1A3C5E' } };
    ca.fill  = fillBg; ca.border = thinBorder;
    ca.alignment = { vertical: 'middle', horizontal: 'left' };

    const cb = ws.getCell(rn, 2);
    cb.value = classifyAccount(ar.currency, ar.closingBal);
    cb.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FF555555' } };
    cb.fill  = fillBg; cb.border = thinBorder;
    cb.alignment = { vertical: 'middle', horizontal: 'left' };

    const cc = ws.getCell(rn, 3);
    cc.value = ar.currency;
    cc.font  = { size: 9, name: 'Calibri', color: { argb: 'FF444444' } };
    cc.fill  = fillBg; cc.border = thinBorder;
    cc.alignment = { vertical: 'middle', horizontal: 'center' };

    const cd = ws.getCell(rn, 4);
    cd.value = ar.openingBal; cd.numFmt = nf;
    cd.font  = { size: 9, name: 'Calibri',
      color: { argb: ar.openingBal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
    cd.fill  = fillBg; cd.border = thinBorder;
    cd.alignment = { vertical: 'middle', horizontal: 'right' };

    const ce = ws.getCell(rn, 5);
    ce.value = ar.inflow; ce.numFmt = nf;
    ce.font  = { size: 9, name: 'Calibri', color: { argb: `FF${C_INCOME}` } };
    ce.fill  = fillBg; ce.border = thinBorder;
    ce.alignment = { vertical: 'middle', horizontal: 'right' };

    const cf = ws.getCell(rn, 6);
    cf.value = ar.outflow; cf.numFmt = nf;
    cf.font  = { size: 9, name: 'Calibri', color: { argb: `FF${C_EXPENSE}` } };
    cf.fill  = fillBg; cf.border = thinBorder;
    cf.alignment = { vertical: 'middle', horizontal: 'right' };

    const cg = ws.getCell(rn, 7);
    cg.value = ar.closingBal; cg.numFmt = nf;
    cg.font  = { bold: true, size: 9, name: 'Calibri',
      color: { argb: ar.closingBal >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
    cg.fill  = { type: 'pattern', pattern: 'solid',
      fgColor: { argb: ar.closingBal >= 0 ? 'FFE8F8F5' : 'FFFDEDEC' } };
    cg.border = thinBorder;
    cg.alignment = { vertical: 'middle', horizontal: 'right' };

    const ch = ws.getCell(rn, 8);
    if (ar.usdEquiv !== null) {
      ch.value = ar.usdEquiv; ch.numFmt = '#,##0.00';
      ch.font  = { bold: true, size: 9, name: 'Calibri',
        color: { argb: ar.usdEquiv >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}` } };
    } else {
      ch.value = '— н/д';
      ch.font  = { size: 8, name: 'Calibri', italic: true, color: { argb: 'FFAAAAAA' } };
    }
    ch.fill  = fillBg; ch.border = thinBorder;
    ch.alignment = { vertical: 'middle', horizontal: 'right' };

    const ci = ws.getCell(rn, 9);
    ci.value  = parseFloat(ar.portfolioPct.toFixed(2));
    ci.numFmt = '0.00"%"';
    ci.font   = { size: 9, name: 'Calibri', color: { argb: 'FF2D6A9F' } };
    ci.fill  = fillBg; ci.border = thinBorder;
    ci.alignment = { vertical: 'middle', horizontal: 'right' };

    const cj = ws.getCell(rn, 10);
    cj.value = fmtDate(ar.lastDate);
    cj.font  = { size: 8, name: 'Calibri', color: { argb: 'FF666666' } };
    cj.fill  = fillBg; cj.border = thinBorder;
    cj.alignment = { vertical: 'middle', horizontal: 'center' };

    rn++;
  };

  // Render a group header row (e.g. "АКТИВЫ", "ОБЯЗАТЕЛЬСТВА")
  const renderGroupHdr = (label: string, bgArgb: string, fgArgb: string) => {
    ws.mergeCells(rn, 1, rn, TOTAL_COLS);
    const c = ws.getCell(rn, 1);
    c.value = label;
    c.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: fgArgb } };
    c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    c.alignment = { horizontal: 'left', vertical: 'middle' };
    c.border = thinBorder;
    ws.getRow(rn).height = 22;
    rn++;
  };

  // Render a subtotal row
  const renderSubtotal = (label: string, usdTotal: number, bgArgb: string, fgArgb: string) => {
    ws.getRow(rn).height = 22;
    for (let ci = 1; ci <= TOTAL_COLS; ci++) {
      ws.getCell(rn, ci).fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      ws.getCell(rn, ci).border = thinBorder;
    }
    ws.mergeCells(rn, 1, rn, 7);
    const sl = ws.getCell(rn, 1);
    sl.value = label;
    sl.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: fgArgb } };
    sl.alignment = { horizontal: 'right', vertical: 'middle' };
    const sv = ws.getCell(rn, 8);
    sv.value  = usdTotal; sv.numFmt = '#,##0.00';
    sv.font   = { bold: true, size: 10, name: 'Calibri', color: { argb: fgArgb } };
    sv.alignment = { horizontal: 'right', vertical: 'middle' };
    const sp = ws.getCell(rn, 9);
    sp.value = '100%';
    sp.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: fgArgb } };
    sp.alignment = { horizontal: 'right', vertical: 'middle' };
    rn++;
  };

  // ── Section 1: АКТИВЫ ────────────────────────────────────────
  renderGroupHdr('📈  АКТИВЫ', 'FFE8F8F5', 'FF1E8449');
  const assetDataStart = rn;
  for (let i = 0; i < assetRows.length; i++) {
    const bg = i % 2 === 0 ? 'FFFFFFFF' : `FF${C_ROW_ODD}`;
    renderAccRow(assetRows[i]!, bg);
  }
  const assetDataEnd = rn - 1;
  renderSubtotal('Итого активы', totalAssetUsd, 'FFD5F5E3', `FF${C_INCOME}`);

  // ── Section 2: ОБЯЗАТЕЛЬСТВА (only if any) ───────────────────
  if (liabRows.length > 0) {
    renderGroupHdr('📉  ОБЯЗАТЕЛЬСТВА', 'FFFDEDEC', 'FFC0392B');
    for (let i = 0; i < liabRows.length; i++) {
      const bg = i % 2 === 0 ? 'FFFFFFFF' : `FF${C_ROW_ODD}`;
      renderAccRow(liabRows[i]!, bg);
    }
    renderSubtotal('Итого обязательств', -(totalLiabUsd), 'FFF5B7B1', `FF${C_EXPENSE}`);
  }

  // ── Data Bars: only on ASSET rows ────────────────────────────
  if (assetRows.length > 0 && assetDataEnd >= assetDataStart) {
    ws.addConditionalFormatting({
      ref: `I${assetDataStart}:I${assetDataEnd}`,
      rules: [{
        type: 'dataBar', priority: 1,
        minLength: 0, maxLength: 100, showValue: true, gradient: false,
        cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 100 }],
      }],
    });
  }

  // ── NET WORTH grand total ────────────────────────────────────
  const footerRow = rn;
  ws.getRow(footerRow).height = 26;
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
  ws.mergeCells(footerRow, 1, footerRow, 7);
  const gtLabel = ws.getCell(footerRow, 1);
  gtLabel.value = 'NET WORTH  (Активы − Обязательства)';
  gtLabel.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: 'FFB0C8E0' } };
  gtLabel.fill  = gtFill;
  gtLabel.alignment = { horizontal: 'right', vertical: 'middle' };

  const totalClr = netWorthUsd >= 0 ? 'FF7DCEA0' : 'FFE57373';
  const gtH = ws.getCell(footerRow, 8);
  gtH.value  = netWorthUsd;
  gtH.numFmt = '#,##0.00';
  gtH.font   = { bold: true, size: 12, name: 'Calibri', color: { argb: totalClr } };
  gtH.fill   = gtFill;
  gtH.alignment = { horizontal: 'right', vertical: 'middle' };
  rn++;

  // ── Footnote ─────────────────────────────────────────────────
  ws.mergeCells(rn, 1, rn, TOTAL_COLS);
  const fn = ws.getCell(rn, 1);
  fn.value = 'Курс на дату экспорта · open.er-api.com (fiat) · mexc.com (crypto) · Доля% = внутри класса (Активы / Обязательства)';
  fn.font  = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
  fn.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
  fn.border = { top: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
  ws.getRow(rn).height = 14;

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

function buildSheet3(wb: ExcelJS.Workbook, rows: TxRow[], usdRates: Map<string, number>): void {
  const ws = wb.addWorksheet('Категории');
  const TOTAL_COLS = 8;

  // ─ Row 1: Title
  ws.mergeCells(1, 1, 1, TOTAL_COLS);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'MIDAS · P&L по категориям (≈ USD)';
  titleCell.font  = { bold: true, size: 13, name: 'Calibri', color: { argb: `FF${C_COL_HDR_FG}` } };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 32;

  // ─ Row 2: Column headers
  const HDR_ROW = 2;
  const colDefs: Array<[string, number]> = [
    ['Группа',          16],
    ['Категория',       24],
    ['Операций',      10],
    ['Расходы ≈ USD',    18],
    ['Доля %',          13],
    ['Доходы ≈ USD',     18],
    ['Чистый итог ≈ USD', 18],
    ['Примечание',      22],
  ];
  colDefs.forEach(([text, width], i) => hdr(ws, i + 1, HDR_ROW, text, width));
  ws.getRow(HDR_ROW).height = 28;

  // ─ Aggregate: P&L intents (income + expense) vs capital movements (debt + transfer)
  type CatEntry = {
    group:          string;
    count:          number;
    expenseUsd:     number;
    incomeUsd:      number;
    uncovered:      string[];   // "50 TRX" for missing rates
  };
  type CapEntry = {
    count:    number;
    totalUsd: number;
    uncov:    string[];
  };

  const PL_INTENTS    = new Set(['income', 'expense']);
  const CAP_INTENTS   = new Set(['debt_given', 'debt_received', 'transfer']);

  const catMap  = new Map<string, CatEntry>();
  const capMap  = new Map<string, CapEntry>();   // key = intent

  for (const r of rows) {
    const amt  = parseFloat(r.original_amount);
    const cur  = r.currency.toUpperCase();
    const rate = usdRates.get(cur) ?? null;
    const usd  = rate !== null ? amt * rate : null;
    const unc  = rate === null ? `${amt.toFixed(2)} ${r.currency}` : null;

    if (PL_INTENTS.has(r.transaction_intent)) {
      const key = r.category_name;
      const cat = catMap.get(key) ?? { group: r.category_group, count: 0, expenseUsd: 0, incomeUsd: 0, uncovered: [] };
      cat.count++;
      if (r.transaction_intent === 'expense') {
        cat.expenseUsd += usd ?? 0;
        if (unc) cat.uncovered.push(unc);
      } else {
        cat.incomeUsd  += usd ?? 0;
        if (unc) cat.uncovered.push(unc);
      }
      catMap.set(key, cat);
    } else if (CAP_INTENTS.has(r.transaction_intent)) {
      if (r.transaction_intent === 'transfer') {
        // Split: internal (paired, has direction) vs external (unpaired, no direction)
        if (r.transfer_direction === 'inbound' || r.transfer_direction === 'outbound') {
          const cap = capMap.get('transfer_internal') ?? { count: 0, totalUsd: 0, uncov: [] };
          cap.count++;
          // For internal, outbound is negative, inbound is positive → nets to 0
          const sign = r.transfer_direction === 'inbound' ? 1 : -1;
          cap.totalUsd += sign * (usd ?? 0);
          if (unc) cap.uncov.push(unc);
          capMap.set('transfer_internal', cap);
        } else {
          // External (unpaired) transfer — treated as expense
          const cap = capMap.get('transfer_external') ?? { count: 0, totalUsd: 0, uncov: [] };
          cap.count++;
          cap.totalUsd += usd ?? 0;
          if (unc) cap.uncov.push(unc);
          capMap.set('transfer_external', cap);
        }
      } else {
        const cap = capMap.get(r.transaction_intent) ?? { count: 0, totalUsd: 0, uncov: [] };
        cap.count++;
        cap.totalUsd += usd ?? 0;
        if (unc) cap.uncov.push(unc);
        capMap.set(r.transaction_intent, cap);
      }
    }
  }

  // Sort by expenseUsd DESC (biggest burn rate first)
  const sorted = [...catMap.entries()].sort((a, b) => b[1].expenseUsd - a[1].expenseUsd);
  const grandExpUsd = sorted.reduce((s, [, c]) => s + c.expenseUsd, 0);
  const grandIncUsd = sorted.reduce((s, [, c]) => s + c.incomeUsd, 0);
  const grandOps    = sorted.reduce((s, [, c]) => s + c.count, 0);

  const thinB = {
    top:    { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    bottom: { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    left:   { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };

  const DATA_START = 3;
  let rn = DATA_START;

  for (const [name, cat] of sorted) {
    const net    = cat.incomeUsd - cat.expenseUsd;
    const pct    = grandExpUsd > 0 ? (cat.expenseUsd / grandExpUsd) * 100 : 0;
    const bgArgb = rn % 2 === 0 ? `FF${C_ROW_ODD}` : 'FFFFFFFF';
    const fillBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgArgb } };
    ws.getRow(rn).height = 18;

    const setCell = (col: number, val: ExcelJS.CellValue, opts: {
      bold?: boolean; numFmt?: string; color?: string;
      align?: 'left'|'center'|'right'; fill?: ExcelJS.Fill;
    } = {}) => {
      const c = ws.getCell(rn, col);
      c.value  = val;
      c.font   = { size: 9, name: 'Calibri', bold: opts.bold,
        color: opts.color ? { argb: opts.color } : undefined };
      c.fill   = opts.fill ?? fillBg;
      c.border = thinB;
      c.alignment = { vertical: 'middle', horizontal: opts.align ?? 'left' };
      if (opts.numFmt) c.numFmt = opts.numFmt;
    };

    setCell(1, cat.group,       { align: 'left',   color: 'FF555555' });
    setCell(2, name,            { bold: true, color: 'FF1A3C5E' });
    setCell(3, cat.count,       { align: 'center' });
    setCell(4, cat.expenseUsd,  { align: 'right',  numFmt: '#,##0.00',
      color: cat.expenseUsd > 0 ? `FF${C_EXPENSE}` : 'FF888888' });
    setCell(5, parseFloat(pct.toFixed(2)), { align: 'right', numFmt: '0.00"%"',
      color: 'FF2D6A9F' });
    setCell(6, cat.incomeUsd,   { align: 'right',  numFmt: '#,##0.00',
      color: cat.incomeUsd > 0 ? `FF${C_INCOME}` : 'FF888888' });
    setCell(7, net, { align: 'right', numFmt: '#,##0.00', bold: true,
      color: net >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`,
      fill: { type: 'pattern', pattern: 'solid',
        fgColor: { argb: net >= 0 ? 'FFE8F8F5' : 'FFFDEDEC' } } });
    setCell(8, cat.uncovered.length > 0 ? `+ ${cat.uncovered.slice(0, 3).join(', ')} (н/д)` : '',
      { align: 'left', color: 'FFAAAAAA' });
    ws.getCell(rn, 8).font = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };

    rn++;
  }

  // ─ Data Bar on Доля % column
  if (rn > DATA_START) {
    ws.addConditionalFormatting({
      ref: `E${DATA_START}:E${rn - 1}`,
      rules: [{
        type: 'dataBar', priority: 1,
        minLength: 0, maxLength: 100,
        showValue: true, gradient: false,
        cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 100 }],
      }],
    });
  }

  // ─ Grand Total row (navy footer)
  const gtFill   = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_GRAND_BG}` } };
  const gtBorder = {
    top: { style: 'medium' as const, color: { argb: 'FF0D2840' } },
    bottom: { style: 'medium' as const, color: { argb: 'FF0D2840' } },
    left:   { style: 'thin'   as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin'   as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };
  const gtRow = rn;
  ws.getRow(gtRow).height = 24;
  for (let ci = 1; ci <= TOTAL_COLS; ci++) {
    ws.getCell(gtRow, ci).fill   = gtFill;
    ws.getCell(gtRow, ci).border = gtBorder;
  }
  ws.mergeCells(gtRow, 1, gtRow, 2);
  const gt1 = ws.getCell(gtRow, 1);
  gt1.value = 'ИТОГО P&L';
  gt1.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: 'FFB0C8E0' } };
  gt1.fill  = gtFill;
  gt1.alignment = { horizontal: 'right', vertical: 'middle' };

  const gt3 = ws.getCell(gtRow, 3);
  gt3.value = grandOps; gt3.font = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FFB0C8E0' } };
  gt3.fill = gtFill; gt3.alignment = { horizontal: 'center', vertical: 'middle' };

  const expClr = grandExpUsd > 0 ? 'FFE57373' : 'FF7DCEA0';
  const gt4 = ws.getCell(gtRow, 4);
  gt4.value = grandExpUsd; gt4.numFmt = '#,##0.00';
  gt4.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: expClr } };
  gt4.fill  = gtFill; gt4.alignment = { horizontal: 'right', vertical: 'middle' };

  const gt5 = ws.getCell(gtRow, 5);
  gt5.value = '100%'; gt5.font = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FFB0C8E0' } };
  gt5.fill = gtFill; gt5.alignment = { horizontal: 'right', vertical: 'middle' };

  const incClr = grandIncUsd > 0 ? 'FF7DCEA0' : 'FFE57373';
  const gt6 = ws.getCell(gtRow, 6);
  gt6.value = grandIncUsd; gt6.numFmt = '#,##0.00';
  gt6.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: incClr } };
  gt6.fill  = gtFill; gt6.alignment = { horizontal: 'right', vertical: 'middle' };

  const grandNet = grandIncUsd - grandExpUsd;
  const netClr   = grandNet >= 0 ? 'FF7DCEA0' : 'FFE57373';
  const gt7 = ws.getCell(gtRow, 7);
  gt7.value = grandNet; gt7.numFmt = '#,##0.00';
  gt7.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: netClr } };
  gt7.fill  = gtFill; gt7.alignment = { horizontal: 'right', vertical: 'middle' };
  rn = gtRow + 1;

  // ─ Capital Movements section (GAAP: not included in P&L)
  if (capMap.size > 0) {
    rn++; // spacer
    ws.mergeCells(rn, 1, rn, TOTAL_COLS);
    const capHdr = ws.getCell(rn, 1);
    capHdr.value = 'ДВИЖЕНИЕ КАПИТАЛА (НЕ включено в P&L)';
    capHdr.font  = { bold: true, size: 9, name: 'Calibri', color: { argb: `FF${C_COL_HDR_FG}` } };
    capHdr.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_COL_HDR_BG}` } };
    capHdr.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(rn).height = 20;
    rn++;

    const capLabels: Record<string, string> = {
      debt_given:         'Долг (дал) — актив',
      debt_received:      'Долг (взял) — обязательство',
      transfer_internal:  'Внутренние переводы (нетто ≈ 0)',
      transfer_external:  'Переводы другим (расход)',
      transfer:           'Переводы',  // fallback for legacy
    };
    for (const [intent, cap] of capMap) {
      const bgArgb = rn % 2 === 0 ? 'FFFFF9F0' : 'FFFFFFFA';
      const fillWarm = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgArgb } };
      ws.getRow(rn).height = 18;

      const setC = (col: number, val: ExcelJS.CellValue, align: 'left'|'center'|'right' = 'left', bold = false, numFmt?: string) => {
        const c = ws.getCell(rn, col);
        c.value = val; c.fill = fillWarm; c.border = thinB;
        c.font  = { size: 9, name: 'Calibri', bold, italic: true, color: { argb: 'FF666666' } };
        c.alignment = { vertical: 'middle', horizontal: align };
        if (numFmt) c.numFmt = numFmt;
      };

      ws.mergeCells(rn, 1, rn, 2);
      setC(1, capLabels[intent] ?? intent, 'left', true);
      setC(3, cap.count, 'center');
      setC(4, cap.totalUsd, 'right', false, '#,##0.00');
      if (cap.uncov.length > 0) setC(8, `+ ${cap.uncov.slice(0, 2).join(', ')} (н/д)`);
      rn++;
    }

    // Footnote
    ws.mergeCells(rn, 1, rn, TOTAL_COLS);
    const fn = ws.getCell(rn, 1);
    fn.value = 'Курс на дату экспорта · open.er-api.com (fiat) · mexc.com (crypto) · Долги и переводы исключены из P&L в соответствии с GAAP';
    fn.font  = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
    fn.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
    fn.border = { top: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
    ws.getRow(rn).height = 14;
  }

  ws.views = [{
    state: 'frozen', ySplit: HDR_ROW, xSplit: 0,
    activeCell: `A${DATA_START}`, showGridLines: false,
  }];
  ws.properties.tabColor = { argb: `FF${C_EXPENSE}` }; // red tab — expense analytics
}

// ─────────────────────────────────────────────────────────────
// Sheet 4: По месяцам
// ─────────────────────────────────────────────────────────────

function buildSheet4(
  wb: ExcelJS.Workbook, rows: TxRow[],
  _from: Date, _to: Date, usdRates: Map<string, number>,
): void {
  // ── Adaptive granularity: month vs week ──────────────────────
  const uniqueMonths = new Set(rows.map(r => {
    const d = new Date(r.transaction_time);
    return `${d.getFullYear()}-${d.getMonth()}`;
  }));
  const useWeeks = uniqueMonths.size <= 1;

  const RU_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                     'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  /** Returns a sortable key + display label for the period bucket */
  const bucketKey = (d: Date): { key: string; label: string } => {
    if (!useWeeks) {
      const idx = d.getMonth();
      return {
        key:   `${d.getFullYear()}-${String(idx).padStart(2, '0')}`,
        label: `${RU_MONTHS[idx]} ${d.getFullYear()}`,
      };
    }
    // Week-level: ISO week start (Monday)
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const dow = (day.getDay() + 6) % 7; // Mon=0
    const weekStart = new Date(day); weekStart.setDate(day.getDate() - dow);
    const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    return {
      key:   weekStart.toISOString().slice(0, 10),
      label: `Нед. ${fmtDate(weekStart)}–${fmtDate(weekEnd)}`,
    };
  };

  // ── Aggregate with USD conversion ───────────────────────────
  type Bucket = {
    label:      string;
    count:      number;
    incomeUsd:  number;
    expenseUsd: number;
    transferUsd: number;
    debtUsd:    number;   // net: debt_received - debt_given
  };
  const bucketMap = new Map<string, Bucket>();

  for (const r of rows) {
    const d    = new Date(r.transaction_time);
    const { key, label } = bucketKey(d);
    const b    = bucketMap.get(key) ?? { label, count: 0, incomeUsd: 0, expenseUsd: 0, transferUsd: 0, debtUsd: 0 };
    const amt  = parseFloat(r.original_amount);
    const cur  = r.currency.toUpperCase();
    const rate = usdRates.get(cur) ?? null;
    const usd  = rate !== null ? amt * rate : 0;

    b.count++;
    if (r.transaction_intent === 'income')         b.incomeUsd   += usd;
    else if (r.transaction_intent === 'expense')   b.expenseUsd  += usd;
    else if (r.transaction_intent === 'transfer') {
      // Direction-aware: internal outbound=−, inbound=+, unpaired=+
      const sign = r.transfer_direction === 'inbound' ? 1 : (r.transfer_direction === 'outbound' ? -1 : 1);
      b.transferUsd += sign * usd;
    }
    else if (r.transaction_intent === 'debt_received') b.debtUsd += usd;
    else if (r.transaction_intent === 'debt_given')    b.debtUsd -= usd;
    bucketMap.set(key, b);
  }

  const sorted = [...bucketMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  // ── Build worksheet ─────────────────────────────────────────
  const granLabel = useWeeks ? 'по неделям' : 'по месяцам';
  const ws = wb.addWorksheet('По месяцам');
  const TOTAL_COLS = 9;

  // Row 1: Title
  ws.mergeCells(1, 1, 1, TOTAL_COLS);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `MIDAS · Динамика ${granLabel} (≈ USD)`;
  titleCell.font  = { bold: true, size: 13, name: 'Calibri', color: { argb: `FF${C_COL_HDR_FG}` } };
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_HEADER_BG}` } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 32;

  // Row 2: Headers
  const HDR_ROW = 2;
  const periodLabel = useWeeks ? 'Неделя' : 'Месяц';
  const colDefs: Array<[string, number]> = [
    [periodLabel,            22],
    ['Операций',           10],
    ['Доходы ≈ USD',        16],
    ['Расходы ≈ USD',       16],
    ['Чистый ≈ USD',        16],
    ['Savings\nRate %',     13],
    ['Δ Расходов',         13],
    ['Переводы\n≈ USD',    14],
    ['Долги нетто\n≈ USD', 14],
  ];
  colDefs.forEach(([text, width], i) => hdr(ws, i + 1, HDR_ROW, text, width));
  ws.getRow(HDR_ROW).height = 30;

  const thinB = {
    top:    { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    bottom: { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    left:   { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin' as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };

  // ── Data rows ───────────────────────────────────────────────
  const DATA_START = 3;
  let rn = DATA_START;
  let prevExpUsd = 0;
  let grandInc = 0, grandExp = 0, grandOps = 0, grandTfr = 0, grandDebt = 0;

  for (let si = 0; si < sorted.length; si++) {
    const [, b] = sorted[si]!;
    const net = b.incomeUsd - b.expenseUsd;
    const sr  = b.incomeUsd > 0 ? ((b.incomeUsd - b.expenseUsd) / b.incomeUsd) * 100 : 0;
    const deltaExp = si > 0 && prevExpUsd > 0
      ? ((b.expenseUsd - prevExpUsd) / prevExpUsd) * 100
      : null;

    grandInc  += b.incomeUsd;
    grandExp  += b.expenseUsd;
    grandOps  += b.count;
    grandTfr  += b.transferUsd;
    grandDebt += b.debtUsd;

    const bgArgb = rn % 2 === 0 ? `FF${C_ROW_ODD}` : 'FFFFFFFF';
    const fillBg = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: bgArgb } };
    ws.getRow(rn).height = 20;

    const sc = (col: number, val: ExcelJS.CellValue, opts: {
      bold?: boolean; numFmt?: string; color?: string; italic?: boolean;
      align?: 'left'|'center'|'right'; fill?: ExcelJS.Fill;
    } = {}) => {
      const c = ws.getCell(rn, col);
      c.value  = val;
      c.font   = { size: 9, name: 'Calibri', bold: opts.bold, italic: opts.italic,
        color: opts.color ? { argb: opts.color } : undefined };
      c.fill   = opts.fill ?? fillBg;
      c.border = thinB;
      c.alignment = { vertical: 'middle', horizontal: opts.align ?? 'left' };
      if (opts.numFmt) c.numFmt = opts.numFmt;
    };

    // A — Period
    sc(1, b.label, { bold: true, color: 'FF1A3C5E' });
    // B — Ops count
    sc(2, b.count, { align: 'center' });
    // C — Income USD
    sc(3, b.incomeUsd, { align: 'right', numFmt: '#,##0.00',
      color: b.incomeUsd > 0 ? `FF${C_INCOME}` : 'FF888888' });
    // D — Expense USD
    sc(4, b.expenseUsd, { align: 'right', numFmt: '#,##0.00',
      color: b.expenseUsd > 0 ? `FF${C_EXPENSE}` : 'FF888888' });
    // E — Net USD
    sc(5, net, { align: 'right', numFmt: '#,##0.00', bold: true,
      color: net >= 0 ? `FF${C_INCOME}` : `FF${C_EXPENSE}`,
      fill: { type: 'pattern', pattern: 'solid',
        fgColor: { argb: net >= 0 ? 'FFE8F8F5' : 'FFFDEDEC' } } });
    // F — Savings Rate %
    if (b.incomeUsd > 0) {
      const srClr = sr >= 20 ? `FF${C_INCOME}` : sr >= 0 ? 'FFD4AC0D' : `FF${C_EXPENSE}`;
      sc(6, parseFloat(sr.toFixed(1)), { align: 'right', numFmt: '0.0"%"', color: srClr, bold: sr >= 20 });
    } else {
      sc(6, '—', { align: 'center', color: 'FFCCCCCC', italic: true });
    }
    // G — Δ Expenses
    if (deltaExp !== null) {
      const arrow = deltaExp > 0 ? '↑' : '↓';
      const dClr  = deltaExp > 0 ? `FF${C_EXPENSE}` : `FF${C_INCOME}`;
      sc(7, `${arrow} ${deltaExp > 0 ? '+' : ''}${deltaExp.toFixed(1)}%`, { align: 'center', color: dClr, bold: true });
    } else {
      sc(7, '—', { align: 'center', color: 'FFCCCCCC', italic: true });
    }
    // H — Transfers USD (secondary)
    sc(8, b.transferUsd, { align: 'right', numFmt: '#,##0.00', italic: true, color: 'FF888888' });
    // I — Debts net USD (secondary)
    sc(9, b.debtUsd, { align: 'right', numFmt: '+#,##0.00;-#,##0.00', italic: true,
      color: b.debtUsd >= 0 ? 'FF888888' : `FF${C_EXPENSE}` });

    prevExpUsd = b.expenseUsd;
    rn++;
  }

  // ── Grand Total footer row ──────────────────────────────────
  const gtFill   = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: `FF${C_GRAND_BG}` } };
  const gtBorder = {
    top: { style: 'medium' as const, color: { argb: 'FF0D2840' } },
    bottom: { style: 'medium' as const, color: { argb: 'FF0D2840' } },
    left:   { style: 'thin'   as const, color: { argb: `FF${C_TBL_BORDER}` } },
    right:  { style: 'thin'   as const, color: { argb: `FF${C_TBL_BORDER}` } },
  };
  const gtRow = rn;
  ws.getRow(gtRow).height = 24;
  for (let ci = 1; ci <= TOTAL_COLS; ci++) {
    ws.getCell(gtRow, ci).fill   = gtFill;
    ws.getCell(gtRow, ci).border = gtBorder;
  }

  const gtFont = (color: string, size = 9) => ({ bold: true, size, name: 'Calibri', color: { argb: color } } as const);
  const gtAlign = (h: 'left'|'center'|'right' = 'right') =>
    ({ horizontal: h, vertical: 'middle' } as const);

  const g1 = ws.getCell(gtRow, 1);
  g1.value = 'ИТОГО'; g1.font = gtFont('FFB0C8E0', 10); g1.fill = gtFill;
  g1.alignment = gtAlign('right');

  const g2 = ws.getCell(gtRow, 2);
  g2.value = grandOps; g2.font = gtFont('FFB0C8E0'); g2.fill = gtFill; g2.alignment = gtAlign('center');

  const g3 = ws.getCell(gtRow, 3);
  g3.value = grandInc; g3.numFmt = '#,##0.00';
  g3.font  = gtFont(grandInc > 0 ? 'FF7DCEA0' : 'FFB0C8E0', 10); g3.fill = gtFill; g3.alignment = gtAlign();

  const g4 = ws.getCell(gtRow, 4);
  g4.value = grandExp; g4.numFmt = '#,##0.00';
  g4.font  = gtFont(grandExp > 0 ? 'FFE57373' : 'FFB0C8E0', 10); g4.fill = gtFill; g4.alignment = gtAlign();

  const grandNet = grandInc - grandExp;
  const g5 = ws.getCell(gtRow, 5);
  g5.value = grandNet; g5.numFmt = '#,##0.00';
  g5.font  = gtFont(grandNet >= 0 ? 'FF7DCEA0' : 'FFE57373', 10); g5.fill = gtFill; g5.alignment = gtAlign();

  // Avg savings rate
  const avgSr = grandInc > 0 ? ((grandInc - grandExp) / grandInc) * 100 : 0;
  const g6 = ws.getCell(gtRow, 6);
  g6.value = `avg ${avgSr.toFixed(1)}%`;
  g6.font  = gtFont(avgSr >= 20 ? 'FF7DCEA0' : avgSr >= 0 ? 'FFD4AC0D' : 'FFE57373');
  g6.fill  = gtFill; g6.alignment = gtAlign();

  const g8 = ws.getCell(gtRow, 8);
  g8.value = grandTfr; g8.numFmt = '#,##0.00';
  g8.font = gtFont('FFB0C8E0'); g8.fill = gtFill; g8.alignment = gtAlign();

  const g9 = ws.getCell(gtRow, 9);
  g9.value = grandDebt; g9.numFmt = '+#,##0.00;-#,##0.00';
  g9.font = gtFont('FFB0C8E0'); g9.fill = gtFill; g9.alignment = gtAlign();

  // ── Footnote ────────────────────────────────────────────────
  const fnRow = gtRow + 1;
  ws.mergeCells(fnRow, 1, fnRow, TOTAL_COLS);
  const fn = ws.getCell(fnRow, 1);
  fn.value = `Гранулярность: ${granLabel} (авто) · Все суммы конвертированы в USD на дату экспорта · Savings Rate = (Incomes − Expenses) / Incomes × 100`;
  fn.font  = { size: 7, italic: true, name: 'Calibri', color: { argb: 'FFAAAAAA' } };
  fn.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C_GREY_BG}` } };
  fn.border = { top: { style: 'thin', color: { argb: `FF${C_TBL_BORDER}` } } };
  ws.getRow(fnRow).height = 14;

  // ── Freeze + gridlines ──────────────────────────────────────
  ws.views = [{
    state: 'frozen', ySplit: HDR_ROW, xSplit: 0,
    activeCell: `A${DATA_START}`, showGridLines: false,
  }];
  ws.properties.tabColor = { argb: 'FF2D6A9F' }; // blue tab — FP&A analytics
}
