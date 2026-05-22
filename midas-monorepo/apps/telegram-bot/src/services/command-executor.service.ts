/**
 * Command Executor Service — Phase 2S2 (Phase 1.1)
 *
 * Unified function `buildCommandResponse()` that generates navigation screen
 * data (text + keyboard) for any NavCommand. Single source of truth used by:
 *   - webhook.route.ts (text input free-text router)
 *   - voice-parse.worker.ts (voice command executor) — via inline duplication
 *
 * SEC-03: All queries use workspaceId + userId from trusted backend context.
 * SEC-12: No user text logged.
 */

import type { InlineKeyboardMarkup } from './telegram-api.js';
import type { NavCommand } from '@midas/shared';
import { getBalanceData } from './balance.service.js';
import { buildBalanceListKeyboard, type BalanceAccountRow } from './balance-keyboard.service.js';
import { formatSettingsMenuText, buildSettingsMainKeyboard } from './settings-keyboard.service.js';
import { buildStartOnboardKeyboard } from './account-onboard-keyboard.service.js';
import { getSettings } from './settings.service.js';
import { withTenantTransaction } from '@midas/database';
import { redisConnection } from '../queues/redis.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CommandContext {
  telegramUserId: string;
  chatId: string;
  workspaceId: string;
  userId: string;
}

export interface CommandResponse {
  text: string;
  keyboard?: InlineKeyboardMarkup;
}

// ─────────────────────────────────────────────────────────────
// Export Step 1 constants (mirrors webhook.route.ts st:exp_start)
// ─────────────────────────────────────────────────────────────

const EXPORT_STEP1_TEXT =
  '📤 <b>Экспорт данных</b>\n\n' +
  'Шаг 1 из 3 — выберите <b>период</b>:';

const EXPORT_STEP1_KB: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '📅 Этот месяц',    callback_data: 'st:exp:p:tm' },
      { text: '📅 Прошлый месяц', callback_data: 'st:exp:p:lm' },
    ],
    [
      { text: '📅 3 месяца',      callback_data: 'st:exp:p:3m' },
      { text: '📅 Весь период',    callback_data: 'st:exp:p:yr' },
    ],
    [{ text: '← Назад', callback_data: 'st:back' }],
  ],
};

// ─────────────────────────────────────────────────────────────
// HELP_TEXT — duplicated from webhook.route.ts for standalone use
// Updated in Phase 4.2 to include voice commands section
// ─────────────────────────────────────────────────────────────

const CMD_HELP_TEXT =
  '🏦 <b>Midas — справочник</b>\n\n' +
  '📝 <b>КАК ЗАПИСАТЬ ОПЕРАЦИЮ</b>\n' +
  'Просто напишите в чат:\n' +
  '<blockquote>кофе 350 RUB\n' +
  'Netflix 15 USDT\n' +
  'зарплата 95 000 RUB\n' +
  'перевод Максу 5 000</blockquote>\n' +
  'Бот распознаёт сумму, тип и категорию автоматически.\n\n' +
  '⭐ <b>ОСНОВНОЙ СЧЁТ</b>\n' +
  'Если у вас выбран ⭐ основной счёт — валюту можно не указывать.\n' +
  'Просто напишите «кофе 15» — Midas сам поймёт куда записать.\n\n' +
  '<i>Изменить: 🏦 Баланс → выберите счёт → Сделать основным</i>\n\n' +
  '🎤 <b>ГОЛОСОВЫЕ КОМАНДЫ</b>\n' +
  '«Покажи баланс» · «Настройки» · «Экспорт»\n' +
  '«Добавь счёт» · «Отмени последнюю» · «Помощь»\n\n' +
  '🎤 <b>ГОЛОСОВЫЕ СООБЩЕНИЯ</b>\n' +
  'Запишите голосовое — бот транскрибирует и создаст транзакцию.\n\n' +
  '📊 <b>ОТЧЁТЫ</b>\n' +
  'Нажмите 📊 Отчёт и выберите нужный период.\n\n' +
  '⚙️ <b>НАСТРОЙКИ</b>\n' +
  '/settings — Часовой пояс и уведомления\n\n' +
  '❓ Вопросы → @midas_support';

// ─────────────────────────────────────────────────────────────
// cancel_last — Phase 3.1: SQL + confirm card
// ─────────────────────────────────────────────────────────────

interface LastTransaction {
  id: string;
  item_name: string | null;
  original_amount: string;
  currency: string;
  transaction_intent: string;
  created_at: string;
  category_name: string | null;
  account_name: string | null;
  account_currency: string | null;
}

async function getLastTransaction(workspaceId: string, userId: string): Promise<LastTransaction | null> {
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<LastTransaction>(
      `SELECT t.id, t.item_name, t.original_amount, t.currency,
              t.transaction_intent, t.created_at,
              c.name AS category_name,
              a.name AS account_name,
              a.currency AS account_currency
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN account_sources a ON a.id = t.account_id
       WHERE t.workspace_id = $1 AND t.deleted_at IS NULL
         AND (t.transfer_direction IS DISTINCT FROM 'inbound')
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [workspaceId],
    );
    return r.rows[0] ?? null;
  });
  return result;
}

function formatCancelCard(tx: LastTransaction): string {
  const intentLabels: Record<string, string> = {
    expense: '\uD83D\uDCE5 Расход',
    income: '\uD83D\uDCE4 Доход',
    transfer: '\uD83D\uDD04 Перевод',
    debt_given: '\uD83D\uDCE4 Долг (дал)',
    debt_received: '\uD83D\uDCE5 Долг (взял)',
  };
  const intent = intentLabels[tx.transaction_intent] ?? tx.transaction_intent;
  const name = tx.item_name ? ` · ${tx.item_name}` : '';
  const dt = (() => {
    try {
      const d = new Date(tx.created_at);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
      return `${hh}:${mm}, ${d.getDate()} ${months[d.getMonth()] ?? ''}`;
    } catch { return tx.created_at; }
  })();
  const amtStr = String(tx.original_amount);
  const amtClean = amtStr.includes('.') ? amtStr.replace(/\.?0+$/, '') : amtStr;
  return `${intent}${name}\n\uD83D\uDCB0 ${amtClean} ${tx.currency}\n\u23F0 ${dt}`;
}

// ─────────────────────────────────────────────────────────────
// Main dispatcher
// ─────────────────────────────────────────────────────────────

/**
 * Build a complete navigation screen response for a detected command.
 *
 * Returns `{ text, keyboard? }` for most commands.
 * Returns sentinel values for complex commands that require
 * delegation to existing webhook route handlers:
 *   - `__DELEGATE_TX__` → transactions (pagination)
 *   - `__DELEGATE_CANCEL__` → Phase 3 (handled inline below now)
 */
export async function buildCommandResponse(
  cmd: NavCommand,
  ctx: CommandContext,
): Promise<CommandResponse> {
  switch (cmd) {
    case 'balance': {
      const { text, accounts } = await getBalanceData(ctx.workspaceId, ctx.userId);
      return { text, keyboard: buildBalanceListKeyboard(accounts as BalanceAccountRow[]) };
    }
    case 'settings': {
      const settings = await getSettings(ctx.workspaceId, ctx.userId);
      return {
        text: formatSettingsMenuText(
          settings?.default_currency ?? 'USDT',
          settings?.timezone ?? 'UTC',
          settings?.main_account_name ?? null,
        ),
        keyboard: buildSettingsMainKeyboard(),
      };
    }
    case 'export':
      return { text: EXPORT_STEP1_TEXT, keyboard: EXPORT_STEP1_KB };
    case 'add_account':
      return {
        text: '➕ <b>Новый счёт</b>\n\nВыберите тип счёта:',
        keyboard: buildStartOnboardKeyboard(),
      };
    case 'help':
      return { text: CMD_HELP_TEXT };
    case 'report': {
      const { buildPeriodPickerKeyboard } = await import('./report-keyboard.service.js');
      return { text: '📊 <b>Отчёты</b>\n\nВыбери период:', keyboard: buildPeriodPickerKeyboard() };
    }
    case 'transactions':
      // Transactions require complex query + pagination → delegate to inline handler
      return { text: '__DELEGATE_TX__' }; // sentinel — webhook handles inline
    case 'cancel_last': {
      // Phase 2S2: cancel_last — show confirmation card with cl:y/cl:n callbacks
      // Saves full tx data to Redis so cl:n can restore the confirmed card.
      const lastTx = await getLastTransaction(ctx.workspaceId, ctx.userId);
      if (!lastTx) {
        return { text: '\uD83D\uDCED \u041D\u0435\u0442 \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0439 \u0434\u043B\u044F \u043E\u0442\u043C\u0435\u043D\u044B.' };
      }

      // Save full data to Redis for cl:n restore (same as voice worker)
      const clDataKey = `midas:cl:data:${lastTx.id}`;
      const clRedisData = {
        intent:          lastTx.transaction_intent,
        amount:          String(lastTx.original_amount),
        currency:        lastTx.currency,
        itemName:        lastTx.item_name ?? null,
        categoryName:    lastTx.category_name ?? null,
        accountName:     lastTx.account_name ?? null,
        transactionTime: lastTx.created_at,
        accountCurrency: lastTx.account_currency ?? null,
        debitAmount:     null,
        debitCurrency:   null,
      };
      void redisConnection.set(clDataKey, JSON.stringify(clRedisData), 'EX', 600);

      const card = formatCancelCard(lastTx);
      return {
        text: `\uD83D\uDDD1 <b>\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u0443 \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044E?</b>\n\n${card}\n\n\u0422\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044F \u0431\u0443\u0434\u0435\u0442 \u0441\u043A\u0440\u044B\u0442\u0430 \u0438\u0437 \u0432\u0441\u0435\u0445 \u043E\u0442\u0447\u0451\u0442\u043E\u0432 \u0438 \u0431\u0430\u043B\u0430\u043D\u0441 \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F.`,
        keyboard: {
          inline_keyboard: [
            [
              { text: '\uD83D\uDDD1 \u0414\u0430, \u0443\u0434\u0430\u043B\u0438\u0442\u044C', callback_data: `cl:y:${lastTx.id}` },
              { text: '\u25C4\uFE0F \u041E\u0442\u043C\u0435\u043D\u0430',                    callback_data: `cl:n:${lastTx.id}` },
            ],
          ],
        },
      };
    }
  }
}
