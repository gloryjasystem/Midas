/**
 * Category Emoji Utility — Phase 4.0-F
 *
 * Single source of truth for category icon resolution.
 * Priority chain:
 *   1. dbIcon (from categories.icon column) — used for custom categories
 *   2. STANDARD_CAT_EMOJI[name] — hardcoded map for 30 standard categories
 *   3. Fallback '📂'
 *
 * Usage: getCategoryEmoji(cat.name, cat.icon)
 */

// ─────────────────────────────────────────────────────────────
// Standard category emoji map (30 categories)
// Source of truth: ALLOWED_CATEGORIES in @midas/ai-core/claude-client.ts
// ─────────────────────────────────────────────────────────────

const STANDARD_CAT_EMOJI: Record<string, string> = {
  // Personal (18)
  'Продукты': '🛒', 'Кафе и рестораны': '☕', 'Транспорт': '🚗',
  'Жильё': '🏠', 'Здоровье': '💊', 'Одежда': '👗',
  'Красота': '💄', 'Развлечения': '🎮', 'Подписки': '📱',
  'Связь': '📡', 'Образование': '📚', 'Спорт': '🏋️',
  'Путешествия': '✈️', 'Подарки': '🎁', 'Дети': '👶',
  'Питомцы': '🐾', 'Дом': '🏡', 'Другое': '📦',
  // Legacy
  'Разное': '🗂️',
  // Business (12)
  'Зарплаты и выплаты': '💰', 'Фриланс': '🤝', 'Реклама': '📣',
  'Софт и сервисы': '💻', 'Оборудование': '🖥️', 'Офис': '🏢',
  'Налоги': '🧾', 'Комиссии': '💸', 'Крипто-комиссии': '⛽',
  'Подрядчики': '👷', 'Продажи': '📈', 'Инвестиции': '💹',
};

const DEFAULT_EMOJI = '📂';

/**
 * Resolve the display emoji for a category.
 *
 * @param name   - Category name (for standard lookup)
 * @param dbIcon - Icon from categories.icon column (nullable)
 * @returns Single emoji string
 */
export function getCategoryEmoji(name: string, dbIcon?: string | null): string {
  if (dbIcon) return dbIcon;
  return STANDARD_CAT_EMOJI[name] ?? DEFAULT_EMOJI;
}
