/**
 * Custom Category FSM Service — Phase 4.0-E
 *
 * Manages the state machine for creating custom categories via Telegram inline UI.
 * State stored in Redis key: midas:cc:{telegramUserId}:{chatId}
 * TTL: 600 seconds (10 minutes)
 *
 * FSM Steps:
 *   name           → User enters category name
 *   confirming_icon → AI picked icon, user confirms or requests manual
 *   icon_manual    → User enters emoji manually
 *   rule           → User enters semantic rule (or skips)
 *
 * Entry points:
 *   cc:new:{draftId}           — from draft category picker
 *   cc:new:tx:{txId}:{from}   — from transaction edit
 *   cc:ok                     — confirm AI-picked icon
 *   cc:reicon                 — request manual emoji
 *   cc:skip                   — skip semantic rule
 *   cc:cancel                 — abort FSM
 *
 * SEC-12: Category names and rules are NOT logged.
 */

import { redisConnection } from '../queues/redis.js';
import { pickCategoryIcon } from '@midas/ai-core';
import type { InlineKeyboardMarkup } from './telegram-api.js';
import {
  createCustomCategory,
  isReservedCategoryName,
  isCategoryNameTaken,
  getCustomCategoryCount,
  MAX_CUSTOM_CATEGORIES,
} from './custom-category.service.js';
import { escapeHtml } from '../utils/html-escape.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** FSM step discriminant. */
export type CcFsmStep = 'name' | 'confirming_icon' | 'icon_manual' | 'rule';

/** Full FSM state stored in Redis as JSON. */
export interface CcFsmState {
  step: CcFsmStep;
  name?: string;                // Set after step 'name' validated
  icon?: string;                // Set after AI pick or manual input
  draftId?: string;             // Set when started from draft picker
  txId?: string;                // Set when started from tx edit
  from?: string;                // tx edit 'from' context (e.g. '0', '0:s')
}

/** Result of processing a text message in the FSM. */
export interface CcFsmTextResult {
  handled: true;
  messageText: string;
  keyboard?: InlineKeyboardMarkup;
}

/** Result when FSM state doesn't exist (text should go to ai-parse). */
export interface CcFsmNotActive {
  handled: false;
}

export type CcFsmResult = CcFsmTextResult | CcFsmNotActive;

// ─────────────────────────────────────────────────────────────
// Redis key helpers
// ─────────────────────────────────────────────────────────────

const CC_KEY_PREFIX = 'midas:cc:';
const CC_TTL = 600; // 10 minutes

export function ccRedisKey(telegramUserId: string, chatId: string): string {
  return `${CC_KEY_PREFIX}${telegramUserId}:${chatId}`;
}

export async function getCcState(
  telegramUserId: string,
  chatId: string,
): Promise<CcFsmState | null> {
  const raw = await redisConnection.get(ccRedisKey(telegramUserId, chatId));
  if (!raw) return null;
  try { return JSON.parse(raw) as CcFsmState; } catch { return null; }
}

export async function setCcState(
  telegramUserId: string,
  chatId: string,
  state: CcFsmState,
): Promise<void> {
  await redisConnection.set(
    ccRedisKey(telegramUserId, chatId),
    JSON.stringify(state),
    'EX', CC_TTL,
  );
}

export async function clearCcState(
  telegramUserId: string,
  chatId: string,
): Promise<void> {
  await redisConnection.del(ccRedisKey(telegramUserId, chatId));
}

// ─────────────────────────────────────────────────────────────
// Emoji validation (mirrors icon-picker.ts logic)
// ─────────────────────────────────────────────────────────────

function isEmoji(str: string): boolean {
  return /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(str);
}

function extractSingleEmoji(text: string): string | null {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segments = [...segmenter.segment(text)];
  if (segments.length !== 1) return null;
  const seg = segments[0]?.segment;
  if (!seg || !isEmoji(seg)) return null;
  return seg;
}

// ─────────────────────────────────────────────────────────────
// FSM Start
// ─────────────────────────────────────────────────────────────

/**
 * Start FSM from draft category picker.
 * Sets Redis state and returns the message to show.
 */
export async function startCcFromDraft(
  telegramUserId: string,
  chatId: string,
  draftId: string,
): Promise<{ text: string; keyboard: InlineKeyboardMarkup }> {
  await setCcState(telegramUserId, chatId, { step: 'name', draftId });
  return {
    text: '✏️ <b>Создание категории</b>\n\nНапиши название (до 60 символов):',
    keyboard: { inline_keyboard: [
      [{ text: '❌ Отмена', callback_data: 'cc:cancel' }],
    ] },
  };
}

/**
 * Start FSM from transaction edit.
 */
export async function startCcFromTx(
  telegramUserId: string,
  chatId: string,
  txId: string,
  from: string,
): Promise<{ text: string; keyboard: InlineKeyboardMarkup }> {
  await setCcState(telegramUserId, chatId, { step: 'name', txId, from });
  return {
    text: '✏️ <b>Создание категории</b>\n\nНапиши название (до 60 символов):',
    keyboard: { inline_keyboard: [
      [{ text: '❌ Отмена', callback_data: 'cc:cancel' }],
    ] },
  };
}

// ─────────────────────────────────────────────────────────────
// FSM Text Processor
// ─────────────────────────────────────────────────────────────

/**
 * Process a text message within the CC FSM.
 * Called BEFORE ai-parse enqueue. If FSM is active, handles text and returns
 * { handled: true, messageText, keyboard }. If not, returns { handled: false }.
 */
export async function processCcText(
  telegramUserId: string,
  chatId: string,
  text: string,
  workspaceId: string,
  userId: string,
): Promise<CcFsmResult> {
  const state = await getCcState(telegramUserId, chatId);
  if (!state) return { handled: false };

  const trimmed = text.trim();

  switch (state.step) {
    case 'name':
      return handleNameStep(telegramUserId, chatId, trimmed, state, workspaceId, userId);
    case 'icon_manual':
      return handleIconManualStep(telegramUserId, chatId, trimmed, state);
    case 'rule':
      return handleRuleStep(telegramUserId, chatId, trimmed, state, workspaceId, userId);
    case 'confirming_icon':
      // Text during confirming_icon step = user typed instead of pressing button.
      // Treat as icon input (forgive wrong step, accept emoji).
      return handleIconManualStep(telegramUserId, chatId, trimmed, state);
    default:
      return { handled: false };
  }
}

// ─────────────────────────────────────────────────────────────
// Step handlers
// ─────────────────────────────────────────────────────────────

async function handleNameStep(
  telegramUserId: string,
  chatId: string,
  name: string,
  state: CcFsmState,
  workspaceId: string,
  userId: string,
): Promise<CcFsmTextResult> {
  // Validation 1: length
  if (name.length === 0 || name.length > 60) {
    return {
      handled: true,
      messageText: '⚠️ Название должно быть от 1 до 60 символов.',
      keyboard: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cc:cancel' }]] },
    };
  }

  // Validation 2: reserved name (BUG-4)
  if (isReservedCategoryName(name)) {
    return {
      handled: true,
      messageText: `⚠️ Название «${escapeHtml(name)}» зарезервировано за стандартной категорией.\nВыберите другое название:`,
      keyboard: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cc:cancel' }]] },
    };
  }

  // Validation 3: duplicate
  try {
    const taken = await isCategoryNameTaken(workspaceId, userId, name);
    if (taken) {
      return {
        handled: true,
        messageText: `⚠️ Категория «${escapeHtml(name)}» уже существует.\nВыберите другое название:`,
        keyboard: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cc:cancel' }]] },
      };
    }
  } catch {
    return {
      handled: true,
      messageText: '⚠️ Ошибка при проверке имени. Попробуйте ещё раз.',
      keyboard: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cc:cancel' }]] },
    };
  }

  // Validation 4: limit
  try {
    const count = await getCustomCategoryCount(workspaceId, userId);
    if (count >= MAX_CUSTOM_CATEGORIES) {
      return {
        handled: true,
        messageText: `⚠️ Максимум ${String(MAX_CUSTOM_CATEGORIES)} своих категорий. Удалите неиспользуемую.`,
        keyboard: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cc:cancel' }]] },
      };
    }
  } catch { /* non-fatal: proceed anyway */ }

  // All validations passed → AI icon pick
  const icon = await pickCategoryIcon(name);

  await setCcState(telegramUserId, chatId, {
    ...state,
    step: 'confirming_icon',
    name,
    icon,
  });

  return {
    handled: true,
    messageText: `${icon} <b>${escapeHtml(name)}</b>\n\nИконка подходит?`,
    keyboard: { inline_keyboard: [
      [
        { text: '✅ Да, подходит', callback_data: 'cc:ok' },
        { text: '🔄 Другую иконку', callback_data: 'cc:reicon' },
      ],
      [{ text: '❌ Отмена', callback_data: 'cc:cancel' }],
    ] },
  };
}

async function handleIconManualStep(
  telegramUserId: string,
  chatId: string,
  input: string,
  state: CcFsmState,
): Promise<CcFsmTextResult> {
  const emoji = extractSingleEmoji(input);
  if (!emoji) {
    return {
      handled: true,
      messageText: '⚠️ Отправь ровно один эмодзи, например 🐶',
      keyboard: { inline_keyboard: [
        [{ text: '◀️ Назад', callback_data: 'cc:reicon:back' }],
        [{ text: '❌ Отмена', callback_data: 'cc:cancel' }],
      ] },
    };
  }

  // Icon accepted → move to rule step
  await setCcState(telegramUserId, chatId, {
    ...state,
    step: 'rule',
    icon: emoji,
  });

  return buildRulePrompt(state.name ?? '', emoji);
}

async function handleRuleStep(
  telegramUserId: string,
  chatId: string,
  rule: string,
  state: CcFsmState,
  workspaceId: string,
  userId: string,
): Promise<CcFsmTextResult> {
  // Validate rule length
  if (rule.length < 3) {
    return {
      handled: true,
      messageText: '⚠️ Опиши подробнее (минимум 3 символа).',
      keyboard: { inline_keyboard: [
        [{ text: '⏩ Пропустить', callback_data: 'cc:skip' }],
        [{ text: '❌ Отмена', callback_data: 'cc:cancel' }],
      ] },
    };
  }
  if (rule.length > 500) {
    return {
      handled: true,
      messageText: `⚠️ Максимум 500 символов (сейчас ${String(rule.length)}).`,
      keyboard: { inline_keyboard: [
        [{ text: '⏩ Пропустить', callback_data: 'cc:skip' }],
        [{ text: '❌ Отмена', callback_data: 'cc:cancel' }],
      ] },
    };
  }

  // Create category with rule
  return finalize(telegramUserId, chatId, state, workspaceId, userId, rule);
}

// ─────────────────────────────────────────────────────────────
// Callback Handlers (called from webhook.route.ts)
// ─────────────────────────────────────────────────────────────

/**
 * cc:ok — User confirmed the AI-picked icon. Move to rule step.
 */
export async function handleCcOk(
  telegramUserId: string,
  chatId: string,
): Promise<CcFsmTextResult | null> {
  const state = await getCcState(telegramUserId, chatId);
  if (!state || state.step !== 'confirming_icon') return null;

  await setCcState(telegramUserId, chatId, { ...state, step: 'rule' });
  return buildRulePrompt(state.name ?? '', state.icon ?? '🏷️');
}

/**
 * cc:reicon — User wants a different icon. Move to icon_manual step.
 */
export async function handleCcReicon(
  telegramUserId: string,
  chatId: string,
): Promise<{ text: string; keyboard: InlineKeyboardMarkup } | null> {
  const state = await getCcState(telegramUserId, chatId);
  if (!state || (state.step !== 'confirming_icon' && state.step !== 'icon_manual')) return null;

  await setCcState(telegramUserId, chatId, { ...state, step: 'icon_manual' });
  return {
    text: '🔄 Отправь один эмодзи:',
    keyboard: { inline_keyboard: [
      [{ text: '❌ Отмена', callback_data: 'cc:cancel' }],
    ] },
  };
}

/**
 * cc:reicon:back — User goes back from manual icon entry.
 * Re-show icon confirmation.
 */
export async function handleCcReiconBack(
  telegramUserId: string,
  chatId: string,
): Promise<{ text: string; keyboard: InlineKeyboardMarkup } | null> {
  const state = await getCcState(telegramUserId, chatId);
  if (!state) return null;

  await setCcState(telegramUserId, chatId, { ...state, step: 'confirming_icon' });

  const icon = state.icon ?? '🏷️';
  const name = state.name ?? '';
  return {
    text: `${icon} <b>${escapeHtml(name)}</b>\n\nИконка подходит?`,
    keyboard: { inline_keyboard: [
      [
        { text: '✅ Да, подходит', callback_data: 'cc:ok' },
        { text: '🔄 Другую иконку', callback_data: 'cc:reicon' },
      ],
      [{ text: '❌ Отмена', callback_data: 'cc:cancel' }],
    ] },
  };
}

/**
 * cc:skip — User skips the semantic rule. Create category with rule = null.
 */
export async function handleCcSkip(
  telegramUserId: string,
  chatId: string,
  workspaceId: string,
  userId: string,
): Promise<CcFsmTextResult | null> {
  const state = await getCcState(telegramUserId, chatId);
  if (!state || state.step !== 'rule') return null;

  return finalize(telegramUserId, chatId, state, workspaceId, userId, null);
}

/**
 * cc:cancel — Abort the FSM. Clean up Redis.
 */
export async function handleCcCancel(
  telegramUserId: string,
  chatId: string,
): Promise<{ text: string }> {
  await clearCcState(telegramUserId, chatId);
  return { text: '❌ Создание категории отменено.' };
}

// ─────────────────────────────────────────────────────────────
// Finalize: Create the category and build success message
// ─────────────────────────────────────────────────────────────

async function finalize(
  telegramUserId: string,
  chatId: string,
  state: CcFsmState,
  workspaceId: string,
  userId: string,
  semanticRule: string | null,
): Promise<CcFsmTextResult> {
  const name = state.name ?? '';
  const icon = state.icon ?? '🏷️';

  let categoryId: string;
  try {
    const result = await createCustomCategory(workspaceId, userId, name, icon, semanticRule);
    if (result.result === 'duplicate') {
      await clearCcState(telegramUserId, chatId);
      return {
        handled: true,
        messageText: `⚠️ Категория «${escapeHtml(name)}» уже существует.`,
      };
    }
    categoryId = result.categoryId;
  } catch {
    await clearCcState(telegramUserId, chatId);
    return {
      handled: true,
      messageText: '⚠️ Ошибка при создании категории. Попробуйте позже.',
    };
  }

  // Clear FSM state
  await clearCcState(telegramUserId, chatId);

  // Build success message
  let successText = `✅ Категория создана!\n\n${icon} <b>${escapeHtml(name)}</b>`;
  if (semanticRule) {
    const truncRule = semanticRule.length > 100
      ? semanticRule.slice(0, 100) + '…'
      : semanticRule;
    successText += `\n📝 «${escapeHtml(truncRule)}»\n\nИИ будет автоматически определять такие траты.`;
  }

  // Return with context for post-creation redirect
  const resultObj: CcFsmTextResult = { handled: true, messageText: successText };

  // Attach redirect info via the keyboard — caller (webhook.route.ts) will
  // use state.draftId / state.txId to trigger the appropriate update.
  if (state.draftId) {
    // Re-render category picker with the new category auto-selected
    resultObj.keyboard = { inline_keyboard: [
      [{ text: `✅ Применить ${icon} ${escapeHtml(name)}`, callback_data: `clar:cat:${categoryId}:${state.draftId}` }],
      [{ text: '📁 К категориям', callback_data: `draft:catg:back:${state.draftId}` }],
    ] };
  } else if (state.txId) {
    const edSuffix = state.from ? `:${state.from}` : '';
    resultObj.keyboard = { inline_keyboard: [
      [{ text: `✅ Применить ${icon} ${escapeHtml(name)}`, callback_data: `ed:c:cat:${state.txId}:${categoryId}` }],
      [{ text: '◀️ Назад', callback_data: `ed:v:${state.txId}${edSuffix}` }],
    ] };
  }

  return resultObj;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function buildRulePrompt(name: string, icon: string): CcFsmTextResult {
  return {
    handled: true,
    messageText:
      `${icon} <b>${escapeHtml(name)}</b> — отлично!\n\n` +
      `Опиши, какие транзакции должны попадать в эту категорию.\n\n` +
      `💡 Например: «Все расходы на мою собаку — ветеринар, корм, игрушки, стрижка»\n\n` +
      `Чем подробнее — тем точнее ИИ будет распознавать.`,
    keyboard: { inline_keyboard: [
      [{ text: '⏩ Пропустить', callback_data: 'cc:skip' }],
      [{ text: '❌ Отмена', callback_data: 'cc:cancel' }],
    ] },
  };
}
