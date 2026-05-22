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
  base_amount: string;
  base_currency: string;
  transaction_intent: string;
  created_at: string;
}

async function getLastTransaction(workspaceId: string, userId: string): Promise<LastTransaction | null> {
  const result = await withTenantTransaction(workspaceId, userId, async (client) => {
    const r = await client.query<LastTransaction>(
      `SELECT id, item_name, base_amount, base_currency, transaction_intent, created_at
       FROM transactions
       WHERE workspace_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [workspaceId],
    );
    return r.rows[0] ?? null;
  });
  return result;
}

function formatCancelCard(tx: LastTransaction): string {
  const intentLabels: Record<string, string> = {
    expense: '📉 Расход',
    income: '📈 Доход',
    transfer: '🔄 Перевод',
    debt_given: '📤 Долг (дал)',
    debt_received: '📥 Долг (взял)',
  };
  const intent = intentLabels[tx.transaction_intent] ?? tx.transaction_intent;
  const name = tx.item_name ? ` · ${tx.item_name}` : '';
  const dt = (() => {
    try {
      const d = new Date(tx.created_at);
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
      return tx.created_at;
    }
  })();
  return `${intent}${name}\n💰 ${tx.base_amount} ${tx.base_currency}\n⏰ ${dt}`;
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
      // Phase 3.1: cancel_last implementation
      const lastTx = await getLastTransaction(ctx.workspaceId, ctx.userId);
      if (!lastTx) {
        return { text: '📭 Нет транзакций для отмены.' };
      }
      const card = formatCancelCard(lastTx);
      return {
        text: `🗑 <b>Удалить эту транзакцию?</b>\n\n${card}\n\nТранзакция будет скрыта из всех отчётов и баланс пересчитается.`,
        keyboard: {
          inline_keyboard: [
            [
              { text: '✅ Да, удалить', callback_data: `ed:del:y:${lastTx.id}` },
              { text: '❌ Нет',         callback_data: `ed:del:n:${lastTx.id}` },
            ],
          ],
        },
      };
    }
  }
}
