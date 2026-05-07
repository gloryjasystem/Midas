/**
 * Set Balance Service — Phase 1.23
 *
 * Implements the /set_balance command: synchronizes the real balance of an account
 * by recalculating account_sources.initial_balance so that /balance shows the target value.
 *
 * Design contract:
 *   - Does NOT create transactions (no correction entries, no balance_adjustments table).
 *   - Does NOT affect /report (report reads transactions only, not initial_balance).
 *   - Supports negative target balances (credit cards, overdrafts — see D4b in balance-semantics.md).
 *   - Balance formula (from balance-semantics.md D1+D2+D3):
 *
 *       balance(account) = initial_balance
 *                        + SUM(income)
 *                        + SUM(debt_received)
 *                        − SUM(expense)
 *                        − SUM(debt_given)
 *                        (transfer is neutral — excluded from sum)
 *
 *   - To show `target_balance` via /balance, we need:
 *
 *       new_initial_balance = target_balance − computed_from_transactions
 *
 *     where:
 *
 *       computed_from_transactions =
 *           SUM(income) + SUM(debt_received) − SUM(expense) − SUM(debt_given)
 *
 *     This UPDATE runs atomically inside withTenantTransaction (SEC-03).
 *
 * Command format: /set_balance <account_name> <amount>
 *   - account_name: exact match (case-insensitive) within the workspace.
 *     If zero accounts match → 'account_not_found'.
 *     If more than one account matches → 'ambiguous' (lists matching names).
 *   - amount: decimal number (positive or negative). Validated as a NUMERIC-safe string.
 *     Parsed via PostgreSQL NUMERIC cast — no JS float math (SEC-02).
 *
 * SEC-02: All financial arithmetic done in PostgreSQL NUMERIC — no JS float math.
 * SEC-03: All queries run inside withTenantTransaction for RLS isolation.
 *         Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS.
 * SEC-12: No account names or amounts in logs — only workspace_id and result type.
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Maximum allowed character length for an account name argument. */
const MAX_ACCOUNT_NAME_LENGTH = 100;

/**
 * Regex for a NUMERIC-safe amount string.
 * Accepts: optional leading "-", digits, optional decimal point with digits.
 * Rejects: scientific notation, multiple dots, letters, spaces.
 *
 * Examples that PASS: "1000", "-500", "1000.50", "-0.01", "0"
 * Examples that FAIL: "1e5", "1.2.3", "abc", "1 000"
 *
 * Integer part capped at 15 digits to stay within NUMERIC(19,4) precision (SEC-02).
 * (Same cap as ai-core/src/schemas.ts AmountString pattern.)
 */
const AMOUNT_REGEX = /^-?\d{1,15}(\.\d{1,4})?$/;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** Row returned by the account lookup query. */
interface AccountRow {
  id: string;
  name: string;
  currency: string;
}

/**
 * Result of a setAccountBalance() call.
 *   done              — initial_balance updated successfully.
 *   account_not_found — no account with the given name in this workspace.
 *   ambiguous         — multiple accounts matched (names returned for user display).
 */
export type SetBalanceResult =
  | { status: 'done'; accountName: string; currency: string; newBalance: string }
  | { status: 'account_not_found' }
  | { status: 'ambiguous'; matchingNames: string[] };

/**
 * Parsed arguments from the /set_balance command.
 * On success: { accountName, amountStr }
 * On failure: { error } — Russian error message to display to the user.
 */
export type ParseSetBalanceResult =
  | { accountName: string; amountStr: string }
  | { error: string };

// ─────────────────────────────────────────────────────────────
// parseSetBalanceArgs
// ─────────────────────────────────────────────────────────────

/**
 * Parse and validate the arguments of the /set_balance command.
 *
 * Input format: /set_balance <account_name> <amount>
 *
 * The account name may contain spaces. The amount is always the LAST whitespace-
 * delimited token. This lets account names with spaces work correctly:
 *   /set_balance My Wallet 1500.00  → accountName="My Wallet", amount="1500.00"
 *   /set_balance Binance 0          → accountName="Binance", amount="0"
 *   /set_balance Карта -500         → accountName="Карта", amount="-500"
 *
 * @param text - Full Telegram message text (e.g. "/set_balance Binance 1000")
 * @returns { accountName, amountStr } on success, or { error } on failure.
 */
export function parseSetBalanceArgs(text: string): ParseSetBalanceResult {
  // Strip the command token and any @BotName suffix
  const trimmed = text.trim();

  // Find the first whitespace after the command token
  const firstSpaceIdx = trimmed.search(/\s/);
  if (firstSpaceIdx === -1) {
    return {
      error:
        'Использование: /set_balance <название счёта> <сумма>\n' +
        'Пример: /set_balance Binance 1500.00\n' +
        'Пример: /set_balance Карта -200\n\n' +
        '⚠️ Это синхронизация баланса, а не трата.',
    };
  }

  // Everything after the command token
  const argsRaw = trimmed.slice(firstSpaceIdx).trim();

  if (argsRaw.length === 0) {
    return {
      error:
        'Использование: /set_balance <название счёта> <сумма>\n' +
        'Пример: /set_balance Binance 1500.00',
    };
  }

  // Split on whitespace. Last token = amount. Everything before = account name.
  const tokens = argsRaw.split(/\s+/);

  if (tokens.length < 2) {
    return {
      error:
        'Нужно указать название счёта И сумму.\n' +
        'Пример: /set_balance Binance 1500.00',
    };
  }

  // Last token is the amount
  const amountStr = tokens[tokens.length - 1] ?? '';
  // Everything before the last token is the account name (preserving inner spaces)
  const accountName = tokens.slice(0, tokens.length - 1).join(' ');

  // Validate account name
  if (accountName.length === 0) {
    return {
      error: 'Название счёта не может быть пустым.',
    };
  }

  if (accountName.length > MAX_ACCOUNT_NAME_LENGTH) {
    return {
      error: `Название счёта слишком длинное (максимум ${String(MAX_ACCOUNT_NAME_LENGTH)} символов).`,
    };
  }

  // Validate amount — NUMERIC-safe format
  if (!AMOUNT_REGEX.test(amountStr)) {
    return {
      error:
        `Неверный формат суммы: «${amountStr}»\n` +
        'Укажите число, например: 1500, 1500.50, -200',
    };
  }

  return { accountName, amountStr };
}

// ─────────────────────────────────────────────────────────────
// setAccountBalance
// ─────────────────────────────────────────────────────────────

/**
 * Synchronize the real balance of an account by updating initial_balance.
 *
 * Finds the account by case-insensitive exact name match within the workspace.
 * Computes `new_initial_balance = target_balance − computed_from_transactions`
 * entirely in PostgreSQL NUMERIC (SEC-02), then UPDATEs account_sources in the
 * same transaction (SEC-03).
 *
 * @param workspaceId  - Internal workspace ULID (trusted backend source — SEC-03)
 * @param userId       - Internal user ULID (required by withTenantTransaction)
 * @param accountName  - Account name as typed by user (case-insensitive match)
 * @param amountStr    - Target balance as a NUMERIC-safe string (e.g. "1500.00")
 * @returns SetBalanceResult
 *
 * SEC-02: All arithmetic done in PostgreSQL NUMERIC. amountStr is passed as a
 *         parameterized SQL literal — no Number()/parseFloat() at the JS boundary.
 * SEC-03: All queries run inside withTenantTransaction. Explicit workspace_id = $1
 *         filter alongside RLS (defense-in-depth).
 * SEC-12: Account name and amount NOT logged. Only workspaceId + result type logged
 *         (logging happens in the caller — webhook.route.ts).
 */
export async function setAccountBalance(
  workspaceId: string,
  userId: string,
  accountName: string,
  amountStr: string,
): Promise<SetBalanceResult> {
  return withTenantTransaction<SetBalanceResult>(
    workspaceId,
    userId,
    async (client) => {
      // ── Step 1: Find matching accounts (case-insensitive, exact name) ──
      //
      // LOWER() on both sides for case-insensitive match.
      // We do NOT use ILIKE to avoid partial/wildcard matches:
      //   "Binance" should NOT match "Binance 2" — exact name only.
      //
      // Defense-in-depth: explicit workspace_id = $1 alongside RLS (SEC-03).
      const findResult = await client.query<AccountRow>(
        `SELECT id, name, currency
         FROM account_sources
         WHERE workspace_id = $1
           AND LOWER(name) = LOWER($2)
         ORDER BY name`,
        [workspaceId, accountName],
      );

      const matchingAccounts = findResult.rows;

      if (matchingAccounts.length === 0) {
        return { status: 'account_not_found' };
      }

      if (matchingAccounts.length > 1) {
        // Should not happen after Phase 1.16 UNIQUE(workspace_id, name) constraint,
        // but guard defensively in case of future constraint relaxation.
        return {
          status: 'ambiguous',
          matchingNames: matchingAccounts.map((r) => r.name),
        };
      }

      // Exactly one account found
      // Length === 1 guaranteed by the checks above, but noUncheckedIndexedAccess
      // requires a safe access pattern (project ESLint bans non-null assertions).
      const account: AccountRow | undefined = matchingAccounts[0];
      if (account === undefined) {
        // Defensive guard — cannot happen after length === 1 check above.
        return { status: 'account_not_found' };
      }

      // ── Step 2: UPDATE initial_balance atomically ──
      //
      // Formula (balance-semantics.md D1+D2+D3):
      //   balance = initial_balance + SUM(income+debt_received) − SUM(expense+debt_given)
      //
      // To make balance = target_balance:
      //   new_initial_balance = target_balance − computed_from_transactions
      //
      // where:
      //   computed_from_transactions =
      //       SUM(income) + SUM(debt_received) − SUM(expense) − SUM(debt_given)
      //
      // All arithmetic done in PostgreSQL NUMERIC (SEC-02).
      // $3::NUMERIC is the safe cast — pg will reject non-numeric strings.
      // Transfer intent is excluded (neutral per D3).
      //
      // Defense-in-depth: t.workspace_id = $1 filter on the JOIN (SEC-03).
      const updateResult = await client.query<{ id: string }>(
        `UPDATE account_sources
         SET initial_balance = (
           -- target_balance − computed_from_transactions
           $3::NUMERIC
           - COALESCE((
               SELECT
                 SUM(CASE WHEN t.transaction_intent = 'income'        THEN  t.base_amount
                          WHEN t.transaction_intent = 'debt_received' THEN  t.base_amount
                          WHEN t.transaction_intent = 'expense'       THEN -t.base_amount
                          WHEN t.transaction_intent = 'debt_given'    THEN -t.base_amount
                          ELSE 0
                     END)
               FROM transactions t
               WHERE t.account_id  = $2
                 AND t.workspace_id = $1
                 AND t.deleted_at IS NULL  -- Phase 1.29: exclude soft-deleted from balance computation
           ), 0)
         )
         WHERE id           = $2
           AND workspace_id = $1
         RETURNING id`,
        [workspaceId, account.id, amountStr],
      );

      if (updateResult.rowCount === 0) {
        // Should not happen — we found the account in Step 1 and this is the same tx.
        // Guard for safety.
        return { status: 'account_not_found' };
      }

      return {
        status: 'done',
        accountName: account.name,
        currency: account.currency,
        // We pass amountStr as the displayed target so the user sees what they requested.
        newBalance: amountStr,
      };
    },
  );
}

// ─────────────────────────────────────────────────────────────
// formatSetBalanceResult — build the user-facing message
// ─────────────────────────────────────────────────────────────

/**
 * Format the result of setAccountBalance() into a Russian user-facing Telegram message.
 *
 * All user-supplied strings (account name, currency) are passed through escapeHtml
 * because the message is sent with parse_mode:'HTML' (Phase 1.15 policy).
 *
 * @param result - SetBalanceResult from setAccountBalance()
 * @param accountNameInput - The account name as the user typed it (for error messages)
 * @returns Formatted Russian HTML-safe string ready for sendMessage()
 */
export function formatSetBalanceResult(
  result: SetBalanceResult,
  accountNameInput: string,
): string {
  if (result.status === 'account_not_found') {
    return (
      `Счёт «${escapeHtml(accountNameInput)}» не найден.\n\n` +
      'Проверьте название через /accounts'
    );
  }

  if (result.status === 'ambiguous') {
    const nameList = result.matchingNames
      .map((n) => `• ${escapeHtml(n)}`)
      .join('\n');
    return (
      `Найдено несколько счетов с похожим названием:\n\n${nameList}\n\n` +
      'Уточните название точнее.'
    );
  }

  // status === 'done'
  const name = escapeHtml(result.accountName);
  const currency = escapeHtml(result.currency);
  const balance = escapeHtml(result.newBalance);

  return (
    `✅ Баланс счёта <b>${name}</b> синхронизирован.\n\n` +
    `Текущий баланс: <b>${balance} ${currency}</b>\n\n` +
    `ℹ️ Это синхронизация, а не трата — транзакций не создавалось.\n` +
    `Используй /balance чтобы проверить.`
  );
}
