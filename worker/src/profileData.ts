import type { AppEnv } from './index';
import * as db from './db';
import { resetKeepsIcon, resetName } from '../../shared/defaultCategories';
import type { Kind } from '../../shared/guidance/kinds';

/**
 * The categories a profile starts from, and what "Reset to defaults" sets it back to. Each expense
 * category carries its kind (shared/guidance/kinds.ts); income categories take none. Groceries and
 * Eating out replaced Food, which a reset renames to Groceries (shared/defaultCategories.ts).
 */
export const DEFAULT_CATEGORIES = [
  {
    type: 'income',
    name: 'Salary',
    color: '#22C55E',
    icon: 'briefcase',
    taxDeductible: 0,
    kind: null,
  },
  {
    type: 'income',
    name: 'Freelance',
    color: '#16A34A',
    icon: 'laptop',
    taxDeductible: 0,
    kind: null,
  },
  {
    type: 'income',
    name: 'Investments',
    color: '#15803D',
    icon: 'trending-up',
    taxDeductible: 0,
    kind: null,
  },
  { type: 'income', name: 'Gifts', color: '#86EFAC', icon: 'gift', taxDeductible: 0, kind: null },
  {
    type: 'expense',
    name: 'Housing',
    color: '#EF4444',
    icon: 'home',
    taxDeductible: 0,
    kind: 'housing',
  },
  {
    type: 'expense',
    name: 'Groceries',
    color: '#F97316',
    icon: 'shopping-cart',
    taxDeductible: 0,
    kind: 'groceries',
  },
  {
    type: 'expense',
    name: 'Eating out',
    color: '#84CC16',
    icon: 'utensils',
    taxDeductible: 0,
    kind: 'eating_out',
  },
  {
    type: 'expense',
    name: 'Transportation',
    color: '#EAB308',
    icon: 'car',
    taxDeductible: 0,
    kind: 'transport',
  },
  {
    type: 'expense',
    name: 'Utilities',
    color: '#8B5CF6',
    icon: 'zap',
    taxDeductible: 0,
    kind: 'utilities',
  },
  {
    type: 'expense',
    name: 'Healthcare',
    color: '#EC4899',
    icon: 'heart',
    taxDeductible: 1,
    kind: 'health',
  },
  {
    type: 'expense',
    name: 'Entertainment',
    color: '#06B6D4',
    icon: 'film',
    taxDeductible: 0,
    kind: 'leisure',
  },
  {
    type: 'expense',
    name: 'Insurance',
    color: '#3B82F6',
    icon: 'shield',
    taxDeductible: 0,
    kind: 'insurance',
  },
  {
    type: 'expense',
    name: 'Shopping',
    color: '#D946EF',
    icon: 'shopping-bag',
    taxDeductible: 0,
    kind: 'shopping',
  },
  {
    type: 'expense',
    name: 'Education',
    color: '#14B8A6',
    icon: 'book',
    taxDeductible: 1,
    kind: 'childcare',
  },
  {
    type: 'expense',
    name: 'Subscriptions',
    color: '#F43F5E',
    icon: 'repeat',
    taxDeductible: 0,
    kind: 'subscriptions',
  },
] as const satisfies readonly {
  type: string;
  name: string;
  color: string;
  icon: string;
  taxDeductible: 0 | 1;
  kind: Kind | null;
}[];

// Every table a profile's rows live in, besides settings and the child tables below. Clearing a
// profile and deleting an account both delete from each one, through profileRowDeletes.
export const PROFILE_TABLES = [
  'receipts',
  'category_mappings',
  'budgets',
  'budgets_zero_based',
  'savings_goals',
  'bills',
  'recurring_transactions',
  'transactions',
  'categories',
  'accounts',
  'loans',
  // tag_rules must be listed before tags: it holds an FK to tags, and D1 deployments with FK
  // enforcement on would reject deleting a tag that still has rules pointing at it.
  'tag_rules',
  'tags',
  'housings',
  'portfolio_holdings',
  'retirement_goals',
  'emergency_fund_config',
  'import_logs',
  // A saved source goes with the data it filled: one on the daily schedule would otherwise fill a
  // cleared profile again at its next sync.
  'import_sources',
] as const;

interface ClearProfileDataOptions {
  includeSettings?: boolean;
  deleteProfilesForUserId?: number;
  seedDefaults?: boolean;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

async function receiptKeys(DB: D1Database, profileIds: number[]): Promise<string[]> {
  if (profileIds.length === 0) return [];
  const ph = placeholders(profileIds.length);
  const rows = await db.all<{ storage_path: string | null }>(
    DB,
    `SELECT storage_path FROM receipts WHERE profile_id IN (${ph})`,
    ...profileIds
  );
  return rows.map((row) => row.storage_path).filter((key): key is string => Boolean(key));
}

async function deleteReceiptObjects(bucket: R2Bucket | undefined, keys: string[]): Promise<void> {
  if (!bucket) return;
  for (let offset = 0; offset < keys.length; offset += 1000) {
    await bucket.delete(keys.slice(offset, offset + 1000));
  }
}

// The deletes that remove every row the given profiles own: child rows first, then each table in
// PROFILE_TABLES, then the profiles' settings when asked. They do not depend on a foreign key's
// cascade to reach any of them.
export function profileRowDeletes(
  DB: D1Database,
  profileIds: readonly number[],
  options: { includeSettings?: boolean } = {}
): D1PreparedStatement[] {
  if (profileIds.length === 0) return [];
  const ph = placeholders(profileIds.length);
  const statements: D1PreparedStatement[] = [];
  const add = (sql: string, ...values: unknown[]) => {
    statements.push(DB.prepare(sql).bind(...values));
  };

  add(
    `DELETE FROM account_balance_history
     WHERE account_id IN (SELECT id FROM accounts WHERE profile_id IN (${ph}))`,
    ...profileIds
  );
  add(
    `DELETE FROM transaction_tags
     WHERE transaction_id IN (SELECT id FROM transactions WHERE profile_id IN (${ph}))`,
    ...profileIds
  );
  add(
    `DELETE FROM loan_rate_periods
     WHERE loan_id IN (SELECT id FROM loans WHERE profile_id IN (${ph}))`,
    ...profileIds
  );
  add(
    `DELETE FROM loan_prepayments
     WHERE loan_id IN (SELECT id FROM loans WHERE profile_id IN (${ph}))`,
    ...profileIds
  );
  for (const table of PROFILE_TABLES) {
    add(`DELETE FROM ${table} WHERE profile_id IN (${ph})`, ...profileIds);
  }
  if (options.includeSettings) {
    add(`DELETE FROM settings WHERE profile_id IN (${ph})`, ...profileIds);
  }
  return statements;
}

export async function clearProfileData(
  env: AppEnv['Bindings'],
  profileIds: number[],
  options: ClearProfileDataOptions = {}
): Promise<void> {
  const pids = [...new Set(profileIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (pids.length === 0) return;

  const keys = await receiptKeys(env.DB, pids);
  await deleteReceiptObjects(env.RECEIPTS, keys);

  const ph = placeholders(pids.length);
  const statements = profileRowDeletes(env.DB, pids, options);
  const add = (sql: string, ...values: unknown[]) => {
    statements.push(env.DB.prepare(sql).bind(...values));
  };

  if (options.seedDefaults) {
    for (const pid of pids) {
      for (const category of DEFAULT_CATEGORIES) {
        add(
          `INSERT INTO categories
             (name, color, icon, type, tax_deductible, kind, profile_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          category.name,
          category.color,
          category.icon,
          category.type,
          category.taxDeductible,
          category.kind,
          pid
        );
      }
    }
  }
  if (options.deleteProfilesForUserId !== undefined) {
    add(
      `DELETE FROM profiles
       WHERE id IN (${ph}) AND user_id = ?`,
      ...pids,
      options.deleteProfilesForUserId
    );
  }

  await env.DB.batch(statements);
}

const NULLABLE_CATEGORY_TABLES = [
  'transactions',
  'savings_goals',
  'bills',
  'recurring_transactions',
] as const;

const REQUIRED_CATEGORY_TABLES = ['budgets', 'budgets_zero_based'] as const;

interface CategoryRow {
  id: number;
  name: string;
  icon?: string | null;
}

/**
 * Before a category's budgets move to the category that replaces it (a reset that keeps Food as
 * Groceries and folds in a Groceries the person made): a moved budget for the same period and start
 * as one the kept category already has is added to that one and removed, so the kept category has
 * one budget for the month, not two. Of two kept budgets that match, the first takes it.
 */
function budgetMergeStatements(
  DB: D1Database,
  profileId: number,
  movedId: number,
  keptId: number
): D1PreparedStatement[] {
  const sameSlot = (alias: string, outer: string) =>
    `${alias}.profile_id = ? AND ${alias}.category_id = ?
     AND ${alias}.period = ${outer}.period AND ${alias}.start_date = ${outer}.start_date`;
  return [
    DB.prepare(
      `UPDATE budgets
       SET amount = amount + (SELECT SUM(m.amount) FROM budgets m WHERE ${sameSlot('m', 'budgets')})
       WHERE profile_id = ? AND category_id = ?
         AND EXISTS (SELECT 1 FROM budgets m WHERE ${sameSlot('m', 'budgets')})
         AND id = (SELECT MIN(k.id) FROM budgets k WHERE ${sameSlot('k', 'budgets')})`
    ).bind(profileId, movedId, profileId, keptId, profileId, movedId, profileId, keptId),
    DB.prepare(
      `DELETE FROM budgets
       WHERE profile_id = ? AND category_id = ?
         AND EXISTS (SELECT 1 FROM budgets k WHERE ${sameSlot('k', 'budgets')})`
    ).bind(profileId, movedId, profileId, keptId),
  ];
}

function categoryReferenceStatements(
  DB: D1Database,
  profileId: number,
  categoryId: number,
  replacementId: number | null
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const table of NULLABLE_CATEGORY_TABLES) {
    statements.push(
      DB.prepare(
        `UPDATE ${table} SET category_id = ? WHERE profile_id = ? AND category_id = ?`
      ).bind(replacementId, profileId, categoryId)
    );
  }
  if (replacementId === null) {
    for (const table of REQUIRED_CATEGORY_TABLES) {
      statements.push(
        DB.prepare(`DELETE FROM ${table} WHERE profile_id = ? AND category_id = ?`).bind(
          profileId,
          categoryId
        )
      );
    }
    statements.push(
      DB.prepare('DELETE FROM category_mappings WHERE profile_id = ? AND category_id = ?').bind(
        profileId,
        categoryId
      )
    );
  } else {
    statements.push(...budgetMergeStatements(DB, profileId, categoryId, replacementId));
    for (const table of REQUIRED_CATEGORY_TABLES) {
      statements.push(
        DB.prepare(
          `UPDATE ${table} SET category_id = ? WHERE profile_id = ? AND category_id = ?`
        ).bind(replacementId, profileId, categoryId)
      );
    }
    statements.push(
      DB.prepare(
        'UPDATE category_mappings SET category_id = ? WHERE profile_id = ? AND category_id = ?'
      ).bind(replacementId, profileId, categoryId)
    );
  }
  return statements;
}

/**
 * Delete a single category and repoint its dependents so nothing is orphaned
 * (audit M-07). Uses the same reference policy as the bulk reset: nullable
 * references (transactions, savings goals, bills, recurring rules) become
 * uncategorized; category-required rows (budgets, zero-based budgets) and
 * mappings are removed; child categories are re-parented to the top level.
 * Runs as one atomic D1 batch.
 */
export async function deleteProfileCategory(
  DB: D1Database,
  profileId: number,
  categoryId: number
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    ...categoryReferenceStatements(DB, profileId, categoryId, null),
    DB.prepare(
      'UPDATE categories SET parent_id = NULL WHERE profile_id = ? AND parent_id = ?'
    ).bind(profileId, categoryId),
    DB.prepare('DELETE FROM categories WHERE id = ? AND profile_id = ?').bind(
      categoryId,
      profileId
    ),
  ];
  await DB.batch(statements);
}

export async function resetProfileCategories(DB: D1Database, profileId: number): Promise<void> {
  const existing = await db.all<CategoryRow>(
    DB,
    'SELECT id, name, icon FROM categories WHERE profile_id = ? ORDER BY id',
    profileId
  );
  const defaultsByName = new Map(
    DEFAULT_CATEGORIES.map((category) => [category.name.toLocaleLowerCase(), category])
  );
  const canonicalIds = new Map<string, number>();
  const statements: D1PreparedStatement[] = [];

  for (const category of existing) {
    // A replaced default (Food) is matched to the default that replaced it (Groceries), and so is
    // renamed to it with its entries instead of being deleted (shared/defaultCategories.ts).
    const normalizedName = resetName(category.name);
    const defaultCategory = defaultsByName.get(normalizedName);
    const canonicalId = canonicalIds.get(normalizedName);

    if (defaultCategory && canonicalId === undefined) {
      canonicalIds.set(normalizedName, category.id);
      statements.push(
        DB.prepare(
          `UPDATE categories
           SET name = ?, color = ?, icon = ?, type = ?, tax_deductible = ?, kind = ?,
               essential = NULL, parent_id = NULL
           WHERE id = ? AND profile_id = ?`
        ).bind(
          defaultCategory.name,
          defaultCategory.color,
          resetKeepsIcon(category.name, category.icon) ? category.icon : defaultCategory.icon,
          defaultCategory.type,
          defaultCategory.taxDeductible,
          defaultCategory.kind,
          category.id,
          profileId
        )
      );
      continue;
    }

    statements.push(
      ...categoryReferenceStatements(DB, profileId, category.id, canonicalId ?? null)
    );
    statements.push(
      DB.prepare('DELETE FROM categories WHERE id = ? AND profile_id = ?').bind(
        category.id,
        profileId
      )
    );
  }

  for (const category of DEFAULT_CATEGORIES) {
    if (canonicalIds.has(category.name.toLocaleLowerCase())) continue;
    statements.push(
      DB.prepare(
        `INSERT INTO categories
           (name, color, icon, type, tax_deductible, kind, profile_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        category.name,
        category.color,
        category.icon,
        category.type,
        category.taxDeductible,
        category.kind,
        profileId
      )
    );
  }

  if (statements.length > 0) await DB.batch(statements);
}
