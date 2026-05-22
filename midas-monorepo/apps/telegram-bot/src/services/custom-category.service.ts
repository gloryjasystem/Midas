/**
 * Custom Category Service — Phase 4.0-C
 *
 * Write-path operations for user-defined semantic categories.
 *
 * Scope:
 *   - createCustomCategory(): INSERT into categories with is_custom=true
 *   - getCustomCategoryCount(): COUNT for 20-category workspace limit
 *   - isReservedCategoryName(): O(1) check against 30 standard taxonomy names
 *   - isCategoryNameTaken(): DB check for UNIQUE(workspace_id, name) collision
 *
 * Design decisions:
 *   D1: Custom categories are stored in the SAME table as standard categories.
 *       This avoids FK changes, JOIN complexity, and report/picker duplication.
 *   D2: group defaults to 'Жизнь' — the DB enum category_group only has
 *       'Бизнес' | 'Жизнь'. Custom categories are visually separated in the
 *       picker via is_custom flag, not via the group column.
 *   D3: Reserved names (BUG-4 fix): case-insensitive check against the 30
 *       standard taxonomy names prevents collisions with resolveCategory().
 *   D4: Limits — max 20 custom categories per workspace, max 60 chars name,
 *       max 500 chars semantic_rule (enforced by callers, not here).
 *
 * SEC-02: No financial amounts. No float arithmetic.
 * SEC-03: All queries run inside withTenantTransaction for RLS isolation.
 *         Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS.
 * SEC-12: Category names and rules are NOT logged (user-provided content).
 */

import { withTenantTransaction } from '@midas/database';
import { monotonicFactory } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Monotonic ULID factory — safe for single-process use. */
const generateUlid = monotonicFactory();

/** Maximum number of custom categories per workspace. */
export const MAX_CUSTOM_CATEGORIES = 20;

/**
 * Reserved category names — the 30 standard taxonomy categories.
 * Stored as lowercase for O(1) case-insensitive lookup (BUG-4 fix).
 *
 * Source of truth: ALLOWED_CATEGORIES in @midas/ai-core/claude-client.ts
 * Must be kept in sync manually (taxonomy changes are extremely rare).
 */
const RESERVED_NAMES_LOWER: ReadonlySet<string> = new Set([
  // Personal (18)
  'продукты',
  'кафе и рестораны',
  'транспорт',
  'жильё',
  'здоровье',
  'одежда',
  'красота',
  'развлечения',
  'подписки',
  'связь',
  'образование',
  'спорт',
  'путешествия',
  'подарки',
  'дети',
  'питомцы',
  'дом',
  'другое',
  // Business (12)
  'зарплаты и выплаты',
  'фриланс',
  'реклама',
  'софт и сервисы',
  'оборудование',
  'офис',
  'налоги',
  'комиссии',
  'крипто-комиссии',
  'подрядчики',
  'продажи',
  'инвестиции',
]);

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Result of a createCustomCategory() call.
 *   created   — new custom category successfully inserted.
 *   duplicate — a category with the same name already exists in this workspace.
 */
export type CreateCustomCategoryResult = 'created' | 'duplicate';

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Check if a category name matches one of the 30 standard taxonomy names.
 * Case-insensitive (BUG-4 fix): "Продукты", "ПРОДУКТЫ", "пРоДукТы" all return true.
 *
 * This is a pure function — no DB call, no async.
 */
export function isReservedCategoryName(name: string): boolean {
  return RESERVED_NAMES_LOWER.has(name.trim().toLowerCase());
}

/**
 * Check if a category with the given name already exists in the workspace.
 * Case-insensitive comparison via LOWER() in SQL.
 *
 * SEC-03: withTenantTransaction + explicit workspace_id filter.
 */
export async function isCategoryNameTaken(
  workspaceId: string,
  userId: string,
  name: string,
): Promise<boolean> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM categories
         WHERE workspace_id = $1 AND LOWER(name) = LOWER($2)
       ) AS exists`,
      [workspaceId, name.trim()],
    );
    return result.rows[0]?.exists ?? false;
  });
}

/**
 * Count the number of custom categories in a workspace.
 * Used to enforce the MAX_CUSTOM_CATEGORIES limit.
 *
 * SEC-03: withTenantTransaction + explicit workspace_id filter.
 */
export async function getCustomCategoryCount(
  workspaceId: string,
  userId: string,
): Promise<number> {
  return withTenantTransaction(workspaceId, userId, async (client) => {
    const result = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM categories
       WHERE workspace_id = $1 AND is_custom = true`,
      [workspaceId],
    );
    return parseInt(result.rows[0]?.cnt ?? '0', 10);
  });
}

/**
 * Insert a new custom category for the workspace.
 *
 * @param workspaceId  - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId       - Internal user ULID (required by withTenantTransaction)
 * @param name         - Category name (pre-validated: trimmed, 1-60 chars, not reserved)
 * @param icon         - Single emoji string (from pickCategoryIcon or user input)
 * @param semanticRule - Free-text description, or null if user skipped (⏩ Пропустить)
 * @returns 'created' | 'duplicate'
 *
 * D2: group = 'Жизнь' (default for custom categories).
 *     Visual separation in picker is handled by is_custom flag, not group.
 *
 * SEC-03: INSERT runs inside withTenantTransaction — RLS policy
 *         tenant_isolation_categories enforces workspace_id via WITH CHECK.
 *         Defense-in-depth: explicit workspace_id = $2 in the INSERT.
 *
 * Duplicate detection: ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key
 * DO NOTHING. If row exists, INSERT returns 0 rows → 'duplicate'.
 */
export async function createCustomCategory(
  workspaceId: string,
  userId: string,
  name: string,
  icon: string,
  semanticRule: string | null,
): Promise<{ result: CreateCustomCategoryResult; categoryId: string }> {
  const categoryId = generateUlid();

  const rowsInserted = await withTenantTransaction<number>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO categories (id, workspace_id, name, "group", icon, semantic_rule, is_custom)
         VALUES ($1, $2, $3, 'Жизнь'::category_group, $4, $5, true)
         ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING
         RETURNING id`,
        [categoryId, workspaceId, name.trim(), icon, semanticRule],
      );
      return result.rowCount ?? 0;
    },
  );

  return {
    result: rowsInserted === 0 ? 'duplicate' : 'created',
    categoryId,
  };
}
