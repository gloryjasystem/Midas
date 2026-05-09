/**
 * Category Resolver Service — Phase 1.35
 *
 * Resolves AI-provided category_hint to an actual category_id in the workspace.
 *
 * Pipeline:
 *   1. Exact name match (case-insensitive) in workspace categories
 *   2. Alias map lookup → find-or-create canonical category
 *   3. Fallback → find-or-create "Другое"
 *
 * Auto-create is safe: canonical names come from hardcoded constants,
 * never from user input. ON CONFLICT DO NOTHING handles races.
 *
 * SEC-01: category_hint is Zod-validated (max 100 chars, trimmed).
 * SEC-03: All queries use the provided PoolClient within tenant transaction.
 * SEC-12: category_hint is NOT logged (user-derived content).
 */

import type { PoolClient } from '@midas/database';
import { ulid } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Alias Map — maps item names / common terms to canonical categories
// Keys are lowercase. Values are exact category names from the 30-taxonomy.
// ─────────────────────────────────────────────────────────────

const CATEGORY_ALIASES: Record<string, string> = {
  // ── Продукты ──
  'продукты': 'Продукты', 'супермаркет': 'Продукты', 'магазин': 'Продукты',
  'сыр': 'Продукты', 'молоко': 'Продукты', 'хлеб': 'Продукты', 'мясо': 'Продукты',
  'овощи': 'Продукты', 'фрукты': 'Продукты', 'рыба': 'Продукты', 'яйца': 'Продукты',
  'масло': 'Продукты', 'крупа': 'Продукты', 'макароны': 'Продукты',

  // ── Кафе и рестораны ──
  'кофе': 'Кафе и рестораны', 'кафе': 'Кафе и рестораны', 'ресторан': 'Кафе и рестораны',
  'обед': 'Кафе и рестораны', 'ужин': 'Кафе и рестораны', 'завтрак': 'Кафе и рестораны',
  'starbucks': 'Кафе и рестораны', 'mcdonalds': 'Кафе и рестораны', "mcdonald's": 'Кафе и рестораны',
  'бургер': 'Кафе и рестораны', 'пицца': 'Кафе и рестораны', 'суши': 'Кафе и рестораны',
  'борщ': 'Кафе и рестораны', 'доставка еды': 'Кафе и рестораны', 'доставка': 'Кафе и рестораны',
  'фастфуд': 'Кафе и рестораны', 'столовая': 'Кафе и рестораны',

  // ── Транспорт ──
  'такси': 'Транспорт', 'uber': 'Транспорт', 'яндекс такси': 'Транспорт',
  'бензин': 'Транспорт', 'заправка': 'Транспорт', 'метро': 'Транспорт',
  'парковка': 'Транспорт', 'автобус': 'Транспорт', 'поезд': 'Транспорт',
  'электричка': 'Транспорт', 'мойка': 'Транспорт', 'штраф': 'Транспорт',

  // ── Жильё ──
  'аренда': 'Жильё', 'коммуналка': 'Жильё', 'ремонт': 'Жильё', 'мебель': 'Жильё',
  'квартира': 'Жильё', 'ипотека': 'Жильё', 'электричество': 'Жильё', 'вода': 'Жильё',
  'газ': 'Жильё',

  // ── Здоровье ──
  'аптека': 'Здоровье', 'врач': 'Здоровье', 'стоматолог': 'Здоровье',
  'лекарства': 'Здоровье', 'анализы': 'Здоровье', 'больница': 'Здоровье',
  'клиника': 'Здоровье', 'медицина': 'Здоровье',

  // ── Одежда ──
  'одежда': 'Одежда', 'обувь': 'Одежда', 'аксессуары': 'Одежда',
  'куртка': 'Одежда', 'кроссовки': 'Одежда', 'джинсы': 'Одежда',

  // ── Красота ──
  'парикмахер': 'Красота', 'парикмахерская': 'Красота', 'косметика': 'Красота',
  'маникюр': 'Красота', 'стрижка': 'Красота', 'барбершоп': 'Красота',

  // ── Развлечения ──
  'кино': 'Развлечения', 'концерт': 'Развлечения', 'бар': 'Развлечения',
  'игры': 'Развлечения', 'театр': 'Развлечения', 'клуб': 'Развлечения',
  'развлечения': 'Развлечения',

  // ── Подписки ──
  'netflix': 'Подписки', 'spotify': 'Подписки', 'youtube': 'Подписки',
  'icloud': 'Подписки', 'apple music': 'Подписки', 'подписка': 'Подписки',
  'яндекс плюс': 'Подписки', 'vpn': 'Подписки',

  // ── Связь ──
  'мобильный': 'Связь', 'интернет': 'Связь', 'телефон': 'Связь',
  'связь': 'Связь', 'сим': 'Связь',

  // ── Образование ──
  'курсы': 'Образование', 'книги': 'Образование', 'обучение': 'Образование',
  'школа': 'Образование', 'университет': 'Образование', 'репетитор': 'Образование',

  // ── Спорт ──
  'спортзал': 'Спорт', 'тренажёрка': 'Спорт', 'фитнес': 'Спорт',
  'абонемент': 'Спорт', 'бассейн': 'Спорт', 'йога': 'Спорт',

  // ── Путешествия ──
  'билеты': 'Путешествия', 'отель': 'Путешествия', 'страховка': 'Путешествия',
  'самолёт': 'Путешествия', 'виза': 'Путешествия', 'хостел': 'Путешествия',

  // ── Подарки ──
  'подарок': 'Подарки', 'подарки': 'Подарки', 'цветы': 'Подарки',
  'благотворительность': 'Подарки',

  // ── Дети ──
  'детский сад': 'Дети', 'игрушки': 'Дети', 'памперсы': 'Дети',

  // ── Питомцы ──
  'корм для кота': 'Питомцы', 'корм для собаки': 'Питомцы', 'ветеринар': 'Питомцы',
  'наполнитель': 'Питомцы', 'питомцы': 'Питомцы', 'зоомагазин': 'Питомцы',
  'pet shop': 'Питомцы', 'pet food': 'Питомцы', 'ошейник': 'Питомцы',
  'поводок': 'Питомцы', 'груминг': 'Питомцы', 'ветклиника': 'Питомцы',
  'еда для кота': 'Питомцы', 'еда для собаки': 'Питомцы',

  // ── Дом ──
  'моющие средства': 'Дом', 'тряпки': 'Дом', 'полотенца': 'Дом',
  'посуда': 'Дом', 'шторы': 'Дом', 'постельное бельё': 'Дом',
  'стиральный порошок': 'Дом', 'бытовая химия': 'Дом', 'пылесос': 'Дом',
  'мусорные пакеты': 'Дом', 'губки': 'Дом', 'лампочки': 'Дом',
  'household': 'Дом', 'ikea': 'Дом', 'cleaning': 'Дом',

  // ── Бизнес: Зарплаты ──
  'зарплата': 'Зарплаты и выплаты', 'аванс': 'Зарплаты и выплаты', 'премия': 'Зарплаты и выплаты',
  'бонус': 'Зарплаты и выплаты',

  // ── Фриланс ──
  'фриланс': 'Фриланс', 'консалтинг': 'Фриланс', 'подработка': 'Фриланс',
  'гонорар': 'Фриланс',

  // ── Реклама ──
  'facebook ads': 'Реклама', 'google ads': 'Реклама', 'таргет': 'Реклама',
  'реклама': 'Реклама', 'маркетинг': 'Реклама',

  // ── Софт и сервисы ──
  'notion': 'Софт и сервисы', 'figma': 'Софт и сервисы', 'хостинг': 'Софт и сервисы',
  'домен': 'Софт и сервисы', 'сервер': 'Софт и сервисы', 'github': 'Софт и сервисы',

  // ── Оборудование ──
  'ноутбук': 'Оборудование', 'монитор': 'Оборудование', 'клавиатура': 'Оборудование',
  'мышка': 'Оборудование', 'наушники': 'Оборудование', 'iphone': 'Оборудование',

  // ── Офис ──
  'офис': 'Офис', 'коворкинг': 'Офис', 'канцелярия': 'Офис',

  // ── Налоги ──
  'налоги': 'Налоги', 'фоп': 'Налоги', 'ип': 'Налоги', 'взносы': 'Налоги',

  // ── Комиссии ──
  'комиссия': 'Комиссии', 'эквайринг': 'Комиссии', 'банковская комиссия': 'Комиссии',

  // ── Крипто-комиссии ──
  'gas': 'Крипто-комиссии', 'gas fee': 'Крипто-комиссии', 'network fee': 'Крипто-комиссии',
  'комиссия биржи': 'Крипто-комиссии', 'exchange fee': 'Крипто-комиссии',

  // ── Подрядчики ──
  'подрядчик': 'Подрядчики', 'аутсорс': 'Подрядчики',

  // ── Продажи ──
  'продажа': 'Продажи', 'выручка': 'Продажи', 'авито': 'Продажи',

  // ── Инвестиции ──
  'акции': 'Инвестиции', 'депозит': 'Инвестиции', 'дивиденды': 'Инвестиции',
  'крипто': 'Инвестиции', 'биткоин': 'Инвестиции', 'эфир': 'Инвестиции',
};

// Category → group mapping (for auto-create)
const CATEGORY_GROUPS: Record<string, 'Бизнес' | 'Жизнь'> = {
  'Продукты': 'Жизнь', 'Кафе и рестораны': 'Жизнь', 'Транспорт': 'Жизнь',
  'Жильё': 'Жизнь', 'Здоровье': 'Жизнь', 'Одежда': 'Жизнь', 'Красота': 'Жизнь',
  'Развлечения': 'Жизнь', 'Подписки': 'Жизнь', 'Связь': 'Жизнь', 'Образование': 'Жизнь',
  'Спорт': 'Жизнь', 'Путешествия': 'Жизнь', 'Подарки': 'Жизнь', 'Дети': 'Жизнь',
  'Питомцы': 'Жизнь', 'Дом': 'Жизнь',
  'Другое': 'Жизнь', 'Разное': 'Жизнь',
  'Зарплаты и выплаты': 'Бизнес', 'Фриланс': 'Бизнес', 'Реклама': 'Бизнес',
  'Софт и сервисы': 'Бизнес', 'Оборудование': 'Бизнес', 'Офис': 'Бизнес',
  'Налоги': 'Бизнес', 'Комиссии': 'Бизнес', 'Крипто-комиссии': 'Бизнес',
  'Подрядчики': 'Бизнес', 'Продажи': 'Бизнес', 'Инвестиции': 'Бизнес',
};

const FALLBACK_CATEGORY = 'Другое';

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Resolve category_hint to a category_id within the workspace.
 *
 * @param client    - PoolClient inside tenant transaction
 * @param workspaceId - workspace ID (SEC-03: from backend, not AI)
 * @param categoryHint - AI-extracted category_hint (Zod-validated, max 100 chars)
 * @returns category_id string
 */
export async function resolveCategory(
  client: PoolClient,
  workspaceId: string,
  categoryHint: string | null | undefined,
): Promise<string> {
  // ── Step 1: If no hint, go straight to fallback ──────────────────────────
  if (!categoryHint || categoryHint.trim().length === 0) {
    return findOrCreateCategory(client, workspaceId, FALLBACK_CATEGORY);
  }

  const hint = categoryHint.trim();

  // ── Step 2: Exact name match (case-insensitive) ──────────────────────────
  const exactResult = await client.query<{ id: string }>(
    `SELECT id FROM categories WHERE workspace_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [workspaceId, hint],
  );
  if (exactResult.rows.length > 0 && exactResult.rows[0]) {
    return exactResult.rows[0].id;
  }

  // ── Step 3: Alias map lookup ─────────────────────────────────────────────
  const canonical = CATEGORY_ALIASES[hint.toLowerCase()];
  if (canonical) {
    return findOrCreateCategory(client, workspaceId, canonical);
  }

  // ── Step 4: Fallback to "Другое" ─────────────────────────────────────────
  return findOrCreateCategory(client, workspaceId, FALLBACK_CATEGORY);
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

/**
 * Find a category by exact name in workspace, or create it.
 * Uses ON CONFLICT to handle concurrent creation safely.
 * Group is determined from CATEGORY_GROUPS map (defaults to 'Жизнь').
 */
async function findOrCreateCategory(
  client: PoolClient,
  workspaceId: string,
  categoryName: string,
): Promise<string> {
  // Try to find first
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM categories WHERE workspace_id = $1 AND name = $2 LIMIT 1`,
    [workspaceId, categoryName],
  );
  if (existing.rows.length > 0 && existing.rows[0]) {
    return existing.rows[0].id;
  }

  // Create with gen_random_uuid()-based ID
  const newId = generateCategoryId();
  const group = CATEGORY_GROUPS[categoryName] ?? 'Жизнь';

  await client.query(
    `INSERT INTO categories (id, workspace_id, name, "group")
     VALUES ($1, $2, $3, $4::category_group)
     ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING`,
    [newId, workspaceId, categoryName, group],
  );

  // Re-fetch in case of conflict (another transaction created it first)
  const refetch = await client.query<{ id: string }>(
    `SELECT id FROM categories WHERE workspace_id = $1 AND name = $2 LIMIT 1`,
    [workspaceId, categoryName],
  );
  return refetch.rows[0]?.id ?? newId;
}

/**
 * Generate a ULID-compatible unique ID for new categories.
 * Uses the ulid library (already a dependency) for ADR-004 compliance.
 * Result matches /^[0-9A-Z]{26}$/ (Crockford Base32) — compatible
 * with all existing ULID_RE validators in /edit and clar: flows.
 */
function generateCategoryId(): string {
  return ulid();
}
