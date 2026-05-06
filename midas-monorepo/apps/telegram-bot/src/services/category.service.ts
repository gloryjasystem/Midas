/**
 * Category Service — Phase 1.11 + Phase 1.13
 *
 * Phase 1.11: Read-only list of categories for a workspace.
 * Phase 1.13: addCategory() — strict-format write path for /add_category command.
 *
 * Scope:
 *   - getCategoryList(): read-only, grouped by category_group enum.
 *   - addCategory(): insert a new category for the workspace.
 *     - Allowed groups: 'Бизнес', 'Жизнь' (case-insensitive input).
 *     - Name: trimmed, non-empty, max 100 chars.
 *     - Duplicate: detected via ON CONFLICT → returns 'duplicate' result.
 *     - No migrations, no new dependencies.
 *
 * SEC-02: No financial amounts involved. No float arithmetic.
 * SEC-03: All queries run inside withTenantTransaction for RLS isolation.
 *         Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS.
 * SEC-12: No raw_text or user PII in logs or output.
 */

import { withTenantTransaction } from '@midas/database';
import { monotonicFactory } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface CategoryRow {
  name: string;
  group: string;
  color: string | null;
}

/**
 * Result of an addCategory() call.
 *   created   — new category successfully inserted.
 *   duplicate — a category with the same name already exists in this workspace.
 */
export type AddCategoryResult = 'created' | 'duplicate';

// ─────────────────────────────────────────────────────────────
// Allowed groups (Phase 1.13)
// Maps lowercase input → canonical enum value stored in DB.
// category_group enum: 'Бизнес' | 'Жизнь'
// ─────────────────────────────────────────────────────────────

const ALLOWED_GROUPS: Record<string, string> = {
  'бизнес': 'Бизнес',
  'жизнь': 'Жизнь',
};

/** Maximum allowed byte/char length for a category name. */
const MAX_CATEGORY_NAME_LENGTH = 100;

// Monotonic ULID factory — safe for single-process use.
const generateUlid = monotonicFactory();

// ─────────────────────────────────────────────────────────────
// Group ordering — matches category_group enum ('Бизнес', 'Жизнь')
// Unknown future groups are appended at the end.
// ─────────────────────────────────────────────────────────────

const GROUP_ORDER: Record<string, number> = {
  'Бизнес': 0,
  'Жизнь': 1,
};

function groupSortKey(group: string): number {
  return GROUP_ORDER[group] ?? 999;
}

// ─────────────────────────────────────────────────────────────
// Category list generator
// ─────────────────────────────────────────────────────────────

/**
 * Generate a read-only text list of categories for the current workspace.
 *
 * @param workspaceId - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId      - Internal user ULID (required by withTenantTransaction)
 * @returns Formatted Russian text string ready for sendMessage
 */
export async function getCategoryList(
  workspaceId: string,
  userId: string,
): Promise<string> {
  const rows = await withTenantTransaction<CategoryRow[]>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<CategoryRow>(
        // Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS (SEC-03).
        // RLS policy tenant_isolation_categories enforces workspace isolation at DB level.
        // This explicit filter ensures correctness even if RLS is ever temporarily bypassed
        // during maintenance or migration.
        `SELECT name, "group", color
         FROM categories
         WHERE workspace_id = $1
         ORDER BY "group", name`,
        [workspaceId],
      );
      return result.rows;
    },
  );

  // ── Empty workspace ────────────────────────────────────────
  if (rows.length === 0) {
    return (
      '📋 <b>Категории вашего кошелька:</b>\n\n' +
      'Категорий пока нет.\n' +
      'Добавьте категорию командой /add_category <группа> <название>.'
    );
  }

  // ── Group categories ───────────────────────────────────────
  // Build a map: group → sorted list of category names
  const groupMap = new Map<string, string[]>();

  for (const row of rows) {
    const existing = groupMap.get(row.group);
    if (existing) {
      existing.push(row.name);
    } else {
      groupMap.set(row.group, [row.name]);
    }
  }

  // Sort groups by known order, unknown groups alphabetically at end
  const sortedGroups = [...groupMap.keys()].sort((a, b) => {
    const orderDiff = groupSortKey(a) - groupSortKey(b);
    if (orderDiff !== 0) return orderDiff;
    return a.localeCompare(b, 'ru');
  });

  // ── Build text output ──────────────────────────────────────
  const sections: string[] = [];

  for (const group of sortedGroups) {
    const names = groupMap.get(group) ?? [];
    const nameLines = names.map((n) => `• ${n}`).join('\n');
    sections.push(`<b>${group}:</b>\n${nameLines}`);
  }

  const totalCount = rows.length;
  const countLabel = `Всего: ${String(totalCount)} ${pluralizeCategories(totalCount)}.`;

  return `📋 <b>Категории вашего кошелька:</b>\n\n${sections.join('\n\n')}\n\n${countLabel}`;
}

// ─────────────────────────────────────────────────────────────
// Russian pluralization for "категория"
// ─────────────────────────────────────────────────────────────

/**
 * Pluralize the word "категория" for Russian number agreement.
 * 1 → категория, 2–4 → категории, 5+ → категорий
 */
function pluralizeCategories(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod100 >= 11 && mod100 <= 19) return 'категорий';
  if (mod10 === 1) return 'категория';
  if (mod10 >= 2 && mod10 <= 4) return 'категории';
  return 'категорий';
}

// ─────────────────────────────────────────────────────────────
// addCategory — Phase 1.13
// ─────────────────────────────────────────────────────────────

/**
 * Validate and normalize the group token from /add_category input.
 *
 * @param rawGroup - The group token as typed by the user (case-insensitive).
 * @returns Canonical group string ('Бизнес' | 'Жизнь') or null if invalid.
 */
export function resolveGroup(rawGroup: string): string | null {
  return ALLOWED_GROUPS[rawGroup.toLowerCase()] ?? null;
}

/**
 * Insert a new category for the given workspace.
 *
 * @param workspaceId  - Internal workspace ULID (from trusted backend — SEC-03)
 * @param userId       - Internal user ULID (required by withTenantTransaction)
 * @param canonicalGroup - Canonical group value ('Бизнес' | 'Жизнь') — must be pre-validated
 * @param name         - Category name (trimmed, non-empty, max 100 chars) — must be pre-validated
 * @returns AddCategoryResult: 'created' | 'duplicate'
 *
 * SEC-03: INSERT runs inside withTenantTransaction — RLS policy tenant_isolation_categories
 *         enforces workspace_id isolation at DB level via WITH CHECK.
 *         Defense-in-depth: explicit workspace_id = $2 in the INSERT.
 * SEC-02: No financial amounts. No float arithmetic.
 * SEC-12: Name and group are NOT logged.
 *
 * Duplicate detection: ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING.
 * If the row already exists, INSERT returns 0 rows → 'duplicate' result.
 */
export async function addCategory(
  workspaceId: string,
  userId: string,
  canonicalGroup: string,
  name: string,
): Promise<AddCategoryResult> {
  const categoryId = generateUlid();

  const rowsInserted = await withTenantTransaction<number>(
    workspaceId,
    userId,
    async (client) => {
      const result = await client.query<{ id: string }>(
        // Defense-in-depth: explicit workspace_id = $2 alongside RLS WITH CHECK.
        // ON CONFLICT ON CONSTRAINT: uses named unique constraint to avoid
        // PL/pgSQL ambiguity errors (same pattern as Phase 1.12 migration).
        `INSERT INTO categories (id, workspace_id, name, "group")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ON CONSTRAINT categories_workspace_id_name_key DO NOTHING
         RETURNING id`,
        [categoryId, workspaceId, name, canonicalGroup],
      );
      return result.rowCount ?? 0;
    },
  );

  return rowsInserted === 0 ? 'duplicate' : 'created';
}

/**
 * Parse and validate the arguments of the /add_category command.
 *
 * Input format:  /add_category <group> <name>
 * The full message text is passed; the command token is consumed.
 *
 * @param text - Full message text from Telegram (e.g. "/add_category Жизнь Кофе")
 * @returns { canonicalGroup, name } on success, or an error string (Russian) on failure.
 */
export function parseAddCategoryArgs(
  text: string,
): { canonicalGroup: string; name: string } | { error: string } {
  // Strip the command token (/add_category or /add_category@BotName)
  // The command token is the first whitespace-delimited token.
  const trimmed = text.trim();
  const firstSpaceIdx = trimmed.search(/\s/);

  if (firstSpaceIdx === -1) {
    // No arguments at all
    return {
      error:
        'Использование: /add_category <группа> <название>\n' +
        'Группы: Бизнес, Жизнь\n' +
        'Пример: /add_category Жизнь Кофе',
    };
  }

  const rest = trimmed.slice(firstSpaceIdx).trimStart();

  // Split rest into groupToken and remainder (name may contain spaces)
  const secondSpaceIdx = rest.search(/\s/);

  if (secondSpaceIdx === -1) {
    // Only group token given, no name
    return {
      error:
        'Использование: /add_category <группа> <название>\n' +
        'Группы: Бизнес, Жизнь\n' +
        'Пример: /add_category Жизнь Кофе',
    };
  }

  const groupToken = rest.slice(0, secondSpaceIdx);
  const rawName = rest.slice(secondSpaceIdx).trim();

  // Validate group (case-insensitive)
  const canonicalGroup = resolveGroup(groupToken);
  if (canonicalGroup === null) {
    return {
      error:
        `Неизвестная группа: «${groupToken}».\n` +
        'Допустимые группы: Бизнес, Жизнь.',
    };
  }

  // Validate name — non-empty after trim
  if (rawName.length === 0) {
    return {
      error:
        'Название категории не может быть пустым.\n' +
        'Пример: /add_category Жизнь Кофе',
    };
  }

  // Validate name — max length
  if (rawName.length > MAX_CATEGORY_NAME_LENGTH) {
    return {
      error:
        `Название категории слишком длинное (максимум ${String(MAX_CATEGORY_NAME_LENGTH)} символов).`,
    };
  }

  return { canonicalGroup, name: rawName };
}
