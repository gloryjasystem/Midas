/**
 * Category Service — Phase 1.11
 *
 * Generates a read-only text list of categories for a workspace.
 *
 * Scope (Phase 1.11):
 *   - Read-only — no category creation, mutation, or deletion.
 *   - Returns all categories for the workspace, grouped by category_group enum.
 *   - Groups: 'Бизнес', 'Жизнь' (from category_group enum in schema).
 *   - Returns plain Russian text for Telegram sendMessage.
 *   - If no categories exist, returns a safe empty-state message.
 *
 * SEC-02: No financial amounts involved. No float arithmetic.
 * SEC-03: Query runs inside withTenantTransaction for RLS isolation.
 *         Defense-in-depth: explicit WHERE workspace_id = $1 alongside RLS.
 * SEC-12: No raw_text or user PII in logs or output.
 */

import { withTenantTransaction } from '@midas/database';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface CategoryRow {
  name: string;
  group: string;
  color: string | null;
}

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
      'Скоро появится команда /add_category — следите за обновлениями.'
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
