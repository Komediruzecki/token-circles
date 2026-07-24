import type { AppEnv } from './index';
import * as db from './db';

export const DEFAULT_CATEGORIES = [
  { type: 'income', name: 'Salary', color: '#22C55E', icon: 'briefcase', taxDeductible: 0 },
  { type: 'income', name: 'Freelance', color: '#16A34A', icon: 'laptop', taxDeductible: 0 },
  {
    type: 'income',
    name: 'Investments',
    color: '#15803D',
    icon: 'trending-up',
    taxDeductible: 0,
  },
  { type: 'income', name: 'Gifts', color: '#86EFAC', icon: 'gift', taxDeductible: 0 },
  { type: 'expense', name: 'Housing', color: '#EF4444', icon: 'home', taxDeductible: 0 },
  { type: 'expense', name: 'Food', color: '#F97316', icon: 'utensils', taxDeductible: 0 },
  {
    type: 'expense',
    name: 'Transportation',
    color: '#EAB308',
    icon: 'car',
    taxDeductible: 0,
  },
  { type: 'expense', name: 'Utilities', color: '#8B5CF6', icon: 'zap', taxDeductible: 0 },
  {
    type: 'expense',
    name: 'Healthcare',
    color: '#EC4899',
    icon: 'heart',
    taxDeductible: 1,
  },
  {
    type: 'expense',
    name: 'Entertainment',
    color: '#06B6D4',
    icon: 'film',
    taxDeductible: 0,
  },
  {
    type: 'expense',
    name: 'Insurance',
    color: '#3B82F6',
    icon: 'shield',
    taxDeductible: 0,
  },
  {
    type: 'expense',
    name: 'Shopping',
    color: '#D946EF',
    icon: 'shopping-bag',
    taxDeductible: 0,
  },
  {
    type: 'expense',
    name: 'Education',
    color: '#14B8A6',
    icon: 'book',
    taxDeductible: 1,
  },
  {
    type: 'expense',
    name: 'Subscriptions',
    color: '#F43F5E',
    icon: 'repeat',
    taxDeductible: 0,
  },
] as const;

const PROFILE_TABLES = [
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
  'tags',
  'housings',
  'portfolio_holdings',
  'retirement_goals',
  'emergency_fund_config',
  'import_logs',
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
  const statements: D1PreparedStatement[] = [];
  const add = (sql: string, ...values: unknown[]) => {
    statements.push(env.DB.prepare(sql).bind(...values));
  };

  add(
    `DELETE FROM account_balance_history
     WHERE account_id IN (SELECT id FROM accounts WHERE profile_id IN (${ph}))`,
    ...pids
  );
  add(
    `DELETE FROM transaction_tags
     WHERE transaction_id IN (SELECT id FROM transactions WHERE profile_id IN (${ph}))`,
    ...pids
  );
  add(
    `DELETE FROM loan_rate_periods
     WHERE loan_id IN (SELECT id FROM loans WHERE profile_id IN (${ph}))`,
    ...pids
  );
  add(
    `DELETE FROM loan_prepayments
     WHERE loan_id IN (SELECT id FROM loans WHERE profile_id IN (${ph}))`,
    ...pids
  );
  for (const table of PROFILE_TABLES) {
    add(`DELETE FROM ${table} WHERE profile_id IN (${ph})`, ...pids);
  }
  if (options.includeSettings) {
    add(`DELETE FROM settings WHERE profile_id IN (${ph})`, ...pids);
  }
  if (options.seedDefaults) {
    for (const pid of pids) {
      for (const category of DEFAULT_CATEGORIES) {
        add(
          `INSERT INTO categories
             (name, color, icon, type, tax_deductible, profile_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          category.name,
          category.color,
          category.icon,
          category.type,
          category.taxDeductible,
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

export async function resetProfileCategories(DB: D1Database, profileId: number): Promise<void> {
  const existing = await db.all<CategoryRow>(
    DB,
    'SELECT id, name FROM categories WHERE profile_id = ? ORDER BY id',
    profileId
  );
  const defaultsByName = new Map(
    DEFAULT_CATEGORIES.map((category) => [category.name.toLocaleLowerCase(), category])
  );
  const canonicalIds = new Map<string, number>();
  const statements: D1PreparedStatement[] = [];

  for (const category of existing) {
    const normalizedName = category.name.trim().toLocaleLowerCase();
    const defaultCategory = defaultsByName.get(normalizedName);
    const canonicalId = canonicalIds.get(normalizedName);

    if (defaultCategory && canonicalId === undefined) {
      canonicalIds.set(normalizedName, category.id);
      statements.push(
        DB.prepare(
          `UPDATE categories
           SET name = ?, color = ?, icon = ?, type = ?, tax_deductible = ?, parent_id = NULL
           WHERE id = ? AND profile_id = ?`
        ).bind(
          defaultCategory.name,
          defaultCategory.color,
          defaultCategory.icon,
          defaultCategory.type,
          defaultCategory.taxDeductible,
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
           (name, color, icon, type, tax_deductible, profile_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        category.name,
        category.color,
        category.icon,
        category.type,
        category.taxDeductible,
        profileId
      )
    );
  }

  if (statements.length > 0) await DB.batch(statements);
}
