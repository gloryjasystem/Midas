/**
 * Transfer Pairing Service — Phase 3.0
 *
 * Provides:
 *   1. Pure UI builders (screen text + inline keyboards) — no DB dependency.
 *   2. DB helper functions for the transfer flow:
 *       - getAvailableTargetAccounts() — accounts the user can transfer TO
 *       - setDraftTargetAccount()      — persist chosen target on draft
 *       - getDraftTransferState()      — read current draft state for rendering
 *
 * FSM flow for internal transfers:
 *   User sends "перевод 500 USDT"
 *     → AI sets parsed_intent = 'transfer'
 *     → Bot shows type picker:  🔄 На мой счёт | 👤 Другому
 *       → internal: show target account picker → preview → confirm
 *       → external: treated as regular expense (existing flow)
 *
 * callback_data conventions (all ≤ 64 bytes):
 *   tp:type:internal:{draftId}  — user chose internal transfer
 *   tp:type:external:{draftId}  — user chose external transfer (→ existing confirm flow)
 *   tp:tgt:{acctId}:{draftId}   — user chose target account (acctId = 26-char ULID)
 *   tp:confirm:{draftId}        — user confirmed paired transfer
 *   tp:cancel:{draftId}         — user cancelled (→ reject draft)
 *
 * SEC-03: all DB queries inside withTenantTransaction.
 * SEC-02: amounts stay as NUMERIC strings — no parseFloat().
 * SEC-12: no user amounts/names in logs.
 * D3: all DB-sourced strings through escapeHtml before rendering.
 */

import { withTenantTransaction } from '@midas/database';
import { escapeHtml } from '../utils/html-escape.js';
import { classifyCurrency } from './account-currency-validator.service.js';

// ─────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────

/** Slim account row for transfer target picker. */
export interface TransferTargetAccount {
  id: string;
  name: string;
  currency: string;
  balance: string; // NUMERIC string (SEC-02)
}

/** Full draft state needed to render the transfer preview card. */
export interface TransferDraftState {
  draftId: string;
  amount: string;               // NUMERIC string — outbound amount
  currency: string;             // tx currency (outbound)
  sourceAccountId: string;
  sourceAccountName: string;
  sourceAccountCurrency: string;
  targetAccountId: string | null;
  targetAccountName: string | null;
  targetAccountCurrency: string | null;
}

/** Result of setDraftTargetAccount. */
export type SetTargetResult = 'ok' | 'draft_not_found' | 'account_not_found';

// ─────────────────────────────────────────────────────────────
// Inline keyboard type — local interface matching
// InlineKeyboardMarkup from telegram-api.ts (same structural shape,
// avoids a circular import while satisfying editMessageText's signature).
// ─────────────────────────────────────────────────────────────

interface InlineKeyboardButton { text: string; callback_data?: string; url?: string; }
interface InlineKeyboardMarkup  { inline_keyboard: InlineKeyboardButton[][]; }

// ─────────────────────────────────────────────────────────────
// Pure UI builders — text screens
// ─────────────────────────────────────────────────────────────

/**
 * Screen shown after AI detected intent = 'transfer'.
 * Asks the user to clarify direction.
 */
export function buildTransferTypeScreen(
  amount: string,
  currency: string,
  fromAccountName: string,
): string {
  return [
    `🔄 <b>Перевод ${escapeHtml(amount)} ${escapeHtml(currency)}</b>`,
    `со счёта <b>${escapeHtml(fromAccountName)}</b>`,
    '',
    'Куда уходят деньги?',
  ].join('\n');
}

/**
 * Screen asking user to pick the target account.
 * Shown after user chose "🔄 На мой другой счёт".
 */
export function buildTargetPickerScreen(
  amount: string,
  currency: string,
  fromAccountName: string,
): string {
  return [
    '🔄 <b>Внутренний перевод</b>',
    `${escapeHtml(amount)} ${escapeHtml(currency)} с <b>${escapeHtml(fromAccountName)}</b>`,
    '',
    '📥 Выберите счёт-получатель:',
  ].join('\n');
}

/**
 * Preview card shown before final confirmation.
 *
 * @param rate — exchange rate description (null if same currency)
 */
export function buildTransferPreviewScreen(
  sourceAccount: string, outAmount: string, outCurrency: string,
  targetAccount: string, inAmount:  string, inCurrency:  string,
  rate: string | null,
): string {
  const lines = [
    '🔄 <b>Внутренний перевод — подтверждение</b>',
    '━━━━━━━━━━━━━━━━━━━━━━━',
    `📤 <b>${escapeHtml(sourceAccount)}</b>`,
    `    − <code>${escapeHtml(outAmount)} ${escapeHtml(outCurrency)}</code>`,
    '',
    `📥 <b>${escapeHtml(targetAccount)}</b>`,
    `    + <code>${escapeHtml(inAmount)} ${escapeHtml(inCurrency)}</code>`,
  ];

  if (rate) {
    lines.push('', `💱 Курс: <code>${escapeHtml(rate)}</code>`);
  }

  lines.push('', 'Подтверждаете перевод?');
  return lines.join('\n');
}

/**
 * Post-approval card shown after successful paired transfer.
 * Displays both legs with updated balances.
 */
export function buildTransferConfirmedCard(
  sourceAccount: string, outAmount: string, outCurrency: string, balanceAfterSource: string,
  targetAccount: string, inAmount:  string, inCurrency:  string, balanceAfterTarget: string,
  timestamp: string,
): string {
  return [
    '✅ <b>Перевод записан</b>',
    '',
    '🔄 Внутренний перевод',
    '━━━━━━━━━━━━━━━━━━━━━━━',
    `📤 <b>${escapeHtml(sourceAccount)}</b>`,
    `    − <code>${escapeHtml(outAmount)} ${escapeHtml(outCurrency)}</code>`,
    `    Остаток: <code>${escapeHtml(balanceAfterSource)} ${escapeHtml(outCurrency)}</code>`,
    '',
    `📥 <b>${escapeHtml(targetAccount)}</b>`,
    `    + <code>${escapeHtml(inAmount)} ${escapeHtml(inCurrency)}</code>`,
    `    Остаток: <code>${escapeHtml(balanceAfterTarget)} ${escapeHtml(inCurrency)}</code>`,
    '━━━━━━━━━━━━━━━━━━━━━━━',
    `🕐 ${escapeHtml(timestamp)}`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Pure UI builders — inline keyboards
// ─────────────────────────────────────────────────────────────

/** Inline keyboard for the transfer type selection screen. */
export function buildTransferTypeKeyboard(draftId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🔄 На мой другой счёт', callback_data: `tp:type:internal:${draftId}` }],
      [{ text: '👤 Другому человеку',   callback_data: `tp:type:external:${draftId}` }],
      [{ text: '✖ Отмена',              callback_data: `tp:cancel:${draftId}` }],
    ],
  };
}

/**
 * Inline keyboard listing target accounts.
 * callback_data: tp:tgt:{acctId}:{draftId} — always ≤ 64 bytes (26+26+8 chars)
 */
export function buildTargetAccountKeyboard(
  accounts: TransferTargetAccount[],
  draftId: string,
): InlineKeyboardMarkup {
  const buttons = accounts.map((acc) => {
    // SEC-02: no parseFloat — strip trailing zeros from NUMERIC string
    const bal = stripTrailingZeros(acc.balance);
    // Currency-aware icon (matches source picker design)
    const isCrypto = classifyCurrency(acc.currency) !== 'fiat';
    const icon = isCrypto ? '💎' : '🏦';
    return [{ text: `${icon} ${acc.name} · ${bal} ${acc.currency}`, callback_data: `tp:tgt:${acc.id}:${draftId}` }];
  });

  // "Создать счёт" — matches source picker's ia:newac flow
  buttons.push([{ text: '➕ Создать счёт', callback_data: `tp:newac:${draftId}` }]);
  buttons.push([{ text: '✖ Отмена', callback_data: `tp:cancel:${draftId}` }]);

  return { inline_keyboard: buttons };
}

/** Strip trailing decimal zeros: "15400.0000" → "15400", "100.50" → "100.5" */
function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

/** Keyboard for the preview/confirmation screen. */
export function buildTransferConfirmKeyboard(draftId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Подтвердить', callback_data: `tp:confirm:${draftId}` },
        { text: '✖ Отмена',      callback_data: `tp:cancel:${draftId}` },
      ],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Branch B — External transfer UI builders
// ─────────────────────────────────────────────────────────────

/**
 * Screen asking "Who are you sending to?" with skip option.
 * Shown after user chose "👤 Другому человеку".
 */
export function buildRecipientScreen(
  amount: string,
  currency: string,
  fromAccountName: string,
): string {
  return [
    `🔄 <b>Перевод ${escapeHtml(amount)} ${escapeHtml(currency)}</b>`,
    `со счёта <b>${escapeHtml(fromAccountName)}</b>`,
    '',
    '<b>Кому переводишь?</b>',
    '',
    '<i>Напиши имя получателя или нажми «Пропустить»</i>',
  ].join('\n');
}

/** Keyboard for recipient screen — skip + cancel. */
export function buildRecipientKeyboard(draftId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '⏩ Пропустить', callback_data: `tp:skip_rcpt:${draftId}` }],
      [{ text: '✖ Отмена',     callback_data: `tp:cancel:${draftId}` }],
    ],
  };
}

/**
 * Category picker screen for external transfers.
 * Shown after recipient name entered/skipped.
 */
export function buildExternalCategoryScreen(
  amount: string,
  currency: string,
  recipientName: string | null,
): string {
  const recipientLine = recipientName
    ? `👤 Получатель: <b>${escapeHtml(recipientName)}</b>`
    : '';
  const lines = [
    `🔄 <b>Перевод ${escapeHtml(amount)} ${escapeHtml(currency)}</b>`,
  ];
  if (recipientLine) lines.push(recipientLine);
  lines.push('', '<b>Категория:</b>');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Category group constants — 2-level picker for external transfers
// ─────────────────────────────────────────────────────────────

/** Emoji icons for individual categories (matching project-wide taxonomy). */
const CATEGORY_ICONS: Record<string, string> = {
  // Services
  'Кафе и рестораны': '☕',
  'Продукты':         '🛒',
  'Красота':          '💆',
  'Здоровье':         '💊',
  'Транспорт':        '🚗',
  'Связь':            '📡',
  'Подписки':         '📱',
  'Образование':      '📚',
  'Спорт':            '🏋',
  'Развлечения':      '🎬',
  'Путешествия':      '✈️',
  'Подарки':          '🎁',
  'Дети':             '👶',
  'Фриланс':          '💻',
  'Одежда':           '👗',
  // Housing
  'Жильё':            '🏠',
  // Business
  'Зарплаты и выплаты': '💵',
  'Инвестиции':         '📈',
  'Комиссии':           '💳',
  'Крипто-комиссии':    '🪙',
  'Налоги':             '🏛',
  'Оборудование':       '🔩',
  'Офис':               '🏢',
  'Подрядчики':         '👷',
  'Продажи':            '💰',
  'Реклама':            '📣',
  'Софт и сервисы':     '💾',
  // Other
  'Другое':             '🗂',
};

/**
 * Maps group key → array of category names belonging to that group.
 * Used to filter workspace categories when building subcategory pickers.
 */
const GROUP_CATEGORIES: Record<string, string[]> = {
  services: [
    'Кафе и рестораны', 'Продукты', 'Красота', 'Здоровье', 'Транспорт',
    'Связь', 'Подписки', 'Образование', 'Спорт', 'Развлечения',
    'Путешествия', 'Подарки', 'Дети', 'Фриланс', 'Одежда',
  ],
  housing: ['Жильё'],
  business: [
    'Зарплаты и выплаты', 'Инвестиции', 'Комиссии', 'Крипто-комиссии',
    'Налоги', 'Оборудование', 'Офис', 'Подрядчики', 'Продажи',
    'Реклама', 'Софт и сервисы',
  ],
  other: ['Другое'],
};

/**
 * Level-1 keyboard — 4 group buttons in a 2×2 grid.
 * Callback: tp:grp:{groupKey}:{draftId} (≤ 42 bytes ✅)
 *
 * 'other' group immediately selects category «Другое» (no sub-picker).
 * 'back' is used internally by sub-picker to return here.
 */
export function buildExternalGroupKeyboard(draftId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🔧 Услуги', callback_data: `tp:grp:services:${draftId}` },
        { text: '🏠 Жильё',  callback_data: `tp:grp:housing:${draftId}` },
      ],
      [
        { text: '💼 Бизнес', callback_data: `tp:grp:business:${draftId}` },
        { text: '🗂 Другое', callback_data: `tp:grp:other:${draftId}` },
      ],
      [{ text: '✖ Отмена', callback_data: `tp:cancel:${draftId}` }],
    ],
  };
}

/**
 * Level-2 keyboard — subcategories within a group, with emoji icons.
 * Filters workspace categories by group name list.
 * Callback: tp:cat:{categoryId}:{draftId} (≤ 60 bytes ✅)
 * Back button: tp:grp:back:{draftId} (38 bytes ✅)
 */
export function buildExternalSubcategoryKeyboard(
  categories: Array<{ id: string; name: string }>,
  groupKey: string,
  draftId: string,
): InlineKeyboardMarkup {
  const groupNames = GROUP_CATEGORIES[groupKey] ?? [];
  // Filter and sort by group order
  const filtered = categories
    .filter((c) => groupNames.includes(c.name))
    .sort((a, b) => groupNames.indexOf(a.name) - groupNames.indexOf(b.name));

  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < filtered.length; i += 2) {
    const row: InlineKeyboardButton[] = [];
    const c1 = filtered[i];
    if (c1) {
      const icon = CATEGORY_ICONS[c1.name] ?? '📁';
      row.push({ text: `${icon} ${c1.name}`, callback_data: `tp:cat:${c1.id}:${draftId}` });
    }
    if (i + 1 < filtered.length) {
      const c2 = filtered[i + 1];
      if (c2) {
        const icon = CATEGORY_ICONS[c2.name] ?? '📁';
        row.push({ text: `${icon} ${c2.name}`, callback_data: `tp:cat:${c2.id}:${draftId}` });
      }
    }
    rows.push(row);
  }

  rows.push([
    { text: '◀️ Назад', callback_data: `tp:grp:back:${draftId}` },
    { text: '✖ Отмена', callback_data: `tp:cancel:${draftId}` },
  ]);
  return { inline_keyboard: rows };
}


// ─────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────

/**
 * Fetch all active accounts the user can transfer TO.
 * Excludes the source account (can't transfer to yourself).
 *
 * SEC-03: withTenantTransaction (RLS enforced).
 * SEC-02: balance returned as NUMERIC string.
 */
export async function getAvailableTargetAccounts(
  workspaceId: string,
  userId: string,
  excludeAccountId: string,
): Promise<TransferTargetAccount[]> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const res = await client.query<{
      id: string;
      name: string;
      currency: string;
      balance: string;
    }>(
      `SELECT
         a.id,
         a.name,
         a.currency,
         -- Canonical direction-aware balance (matches getWorkspaceAccountsWithBalances)
         (
           a.initial_balance
           + COALESCE(
               SUM(
                 CASE
                   WHEN t.transaction_intent IN ('income', 'debt_received')
                     THEN t.base_amount
                   WHEN t.transaction_intent = 'transfer'
                    AND t.transfer_direction = 'inbound'
                     THEN t.base_amount
                   WHEN t.transaction_intent = 'transfer'
                    AND (t.transfer_direction = 'outbound' OR t.transfer_direction IS NULL)
                     THEN -t.base_amount
                   ELSE -t.base_amount
                 END
               ),
               0
             )
         )::TEXT AS balance
       FROM account_sources a
       LEFT JOIN transactions t
         ON t.account_id = a.id
        AND t.base_currency = a.currency
        AND t.deleted_at IS NULL
       WHERE a.workspace_id = $1
         AND a.deleted_at IS NULL
         AND a.id != $2
         AND a.is_onboarding_placeholder = FALSE
       GROUP BY a.id, a.name, a.currency, a.initial_balance
       ORDER BY a.name ASC`,
      [workspaceId, excludeAccountId],
    );

    return res.rows.map((r) => ({
      id:       r.id,
      name:     r.name,
      currency: r.currency,
      balance:  r.balance ?? '0',
    }));
  });
}

/**
 * Persist the chosen target account on the draft.
 *
 * SEC-03: withTenantTransaction (RLS enforced).
 * IDOR guard: validates target account belongs to same workspace.
 */
export async function setDraftTargetAccount(
  draftId: string,
  workspaceId: string,
  userId: string,
  targetAccountId: string,
): Promise<SetTargetResult> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    // IDOR guard: ensure target account belongs to this workspace
    const acctCheck = await client.query<{ id: string }>(
      `SELECT id FROM account_sources
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [targetAccountId, workspaceId],
    );
    if (acctCheck.rows.length === 0) return 'account_not_found';

    const result = await client.query<{ id: string }>(
      `UPDATE transaction_drafts
       SET transfer_target_account_id = $1,
           updated_at = NOW()
       WHERE id = $2
         AND workspace_id = $3
         AND status = 'pending_user'
       RETURNING id`,
      [targetAccountId, draftId, workspaceId],
    );

    return result.rowCount === 0 ? 'draft_not_found' : 'ok';
  });
}

/**
 * Read the current draft transfer state for building the preview card.
 * Returns null if draft not found, expired, or not a transfer draft.
 *
 * SEC-03: withTenantTransaction (RLS enforced).
 * SEC-12: no amounts or names logged.
 */
export async function getDraftTransferState(
  draftId: string,
  workspaceId: string,
  userId: string,
): Promise<TransferDraftState | null> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const res = await client.query<{
      id: string;
      parsed_amount: string | null;
      parsed_currency: string | null;
      account_id: string | null;
      transfer_target_account_id: string | null;
      src_name: string | null;
      src_currency: string | null;
      tgt_name: string | null;
      tgt_currency: string | null;
    }>(
      `SELECT
         d.id,
         d.parsed_amount::TEXT AS parsed_amount,
         d.parsed_currency,
         d.account_id,
         d.transfer_target_account_id,
         src.name       AS src_name,
         src.currency   AS src_currency,
         tgt.name       AS tgt_name,
         tgt.currency   AS tgt_currency
       FROM transaction_drafts d
       LEFT JOIN account_sources src ON src.id = d.account_id
       LEFT JOIN account_sources tgt ON tgt.id = d.transfer_target_account_id
       WHERE d.id = $1
         AND d.workspace_id = $2
         AND d.status = 'pending_user'
         AND d.parsed_intent = 'transfer'
         AND d.expires_at > NOW()`,
         [draftId, workspaceId],
         );

    const row = res.rows[0];
    if (!row || !row.account_id) return null;

    return {
      draftId:              row.id,
      amount:               String(row.parsed_amount ?? '0'),
      currency:             row.parsed_currency ?? 'USDT',
      sourceAccountId:      row.account_id,
      sourceAccountName:    escapeHtml(row.src_name    ?? 'Счёт'),
      sourceAccountCurrency: row.src_currency ?? 'USDT',
      targetAccountId:      row.transfer_target_account_id ?? null,
      targetAccountName:    row.tgt_name    ? escapeHtml(row.tgt_name)    : null,
      targetAccountCurrency: row.tgt_currency ?? null,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Branch B — External transfer DB helpers
// ─────────────────────────────────────────────────────────────

/**
 * Patch item_name on a draft with the recipient name.
 * Used by Branch B external transfer flow.
 *
 * SEC-12: name not logged. SEC-03: withTenantTransaction.
 */
export async function patchDraftItemName(
  draftId: string,
  workspaceId: string,
  userId: string,
  recipientName: string,
): Promise<'ok' | 'not_found'> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE transaction_drafts
       SET item_name = $1, updated_at = NOW()
       WHERE id = $2
         AND workspace_id = $3
         AND status = 'pending_user'
         AND expires_at > NOW()
       RETURNING id`,
      [recipientName, draftId, workspaceId],
    );
    return result.rowCount === 0 ? 'not_found' : 'ok';
  });
}

/**
 * Patch category_id on a draft for external transfers.
 * SEC-01: categoryId validated via IDOR guard. SEC-03: withTenantTransaction.
 */
export async function patchDraftCategoryForExternal(
  draftId: string,
  workspaceId: string,
  userId: string,
  categoryId: string | null,
): Promise<'ok' | 'not_found'> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    // IDOR guard for non-null category
    if (categoryId !== null) {
      const catCheck = await client.query<{ id: string }>(
        `SELECT id FROM categories WHERE id = $1 AND workspace_id = $2`,
        [categoryId, workspaceId],
      );
      if (catCheck.rows.length === 0) return 'not_found';
    }

    // Variant A: keep parsed_intent = 'transfer' — external transfers stay as transfers.
    // Category is stored for analytics (why the transfer was made).
    // This matches enterprise patterns (Revolut, Wise, N26): person-to-person transfers
    // are a distinct intent from expenses.
    const result = await client.query<{ id: string }>(
      `UPDATE transaction_drafts
       SET category_id = $1,
           updated_at = NOW()
       WHERE id = $2
         AND workspace_id = $3
         AND status = 'pending_user'
         AND expires_at > NOW()
       RETURNING id`,
      [categoryId, draftId, workspaceId],
    );
    return result.rowCount === 0 ? 'not_found' : 'ok';
  });
}

// ─────────────────────────────────────────────────────────────
// Branch A — Cross-currency internal transfer UI + DB helpers
// ─────────────────────────────────────────────────────────────

/**
 * Screen asking user to enter the credited amount in the target currency.
 * Shown when source and target accounts have different currencies.
 */
export function buildCrossCurrencyTransferScreen(
  sourceAccount: string, outAmount: string, outCurrency: string,
  targetAccount: string, targetCurrency: string,
): string {
  return [
    '🔄 <b>Конвертация</b>',
    `${escapeHtml(sourceAccount)} (${escapeHtml(outCurrency)}) → ${escapeHtml(targetAccount)} (${escapeHtml(targetCurrency)})`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━',
    `📤 Списываю: <code>${escapeHtml(outAmount)} ${escapeHtml(outCurrency)}</code>`,
    `📥 Зачисляю: <b>_____ ${escapeHtml(targetCurrency)}</b>`,
    '',
    `<i>Введите сумму зачисления в ${escapeHtml(targetCurrency)}:</i>`,
  ].join('\n');
}

/** Keyboard for the cross-currency transfer input screen. */
export function buildCrossCurrencyTransferKeyboard(draftId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '◀️ Назад', callback_data: `tp:xfx_back:${draftId}` }],
      [{ text: '✖ Отмена', callback_data: `tp:cancel:${draftId}` }],
    ],
  };
}

/**
 * Patch the credited amount for cross-currency internal transfers.
 * Stores the user-entered amount + currency of the target account
 * in account_debit_amount and account_debit_currency on the draft.
 *
 * SEC-02: amount stays as NUMERIC string. SEC-03: withTenantTransaction.
 */
export async function patchDraftCreditedAmount(
  draftId: string,
  workspaceId: string,
  userId: string,
  creditedAmount: string,
  creditedCurrency: string,
): Promise<'ok' | 'not_found'> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE transaction_drafts
       SET account_debit_amount = $1::NUMERIC,
           account_debit_currency = $2,
           updated_at = NOW()
       WHERE id = $3
         AND workspace_id = $4
         AND status = 'pending_user'
         AND expires_at > NOW()
       RETURNING id`,
      [creditedAmount, creditedCurrency, draftId, workspaceId],
    );
    return result.rowCount === 0 ? 'not_found' : 'ok';
  });
}
