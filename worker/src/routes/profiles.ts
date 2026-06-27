import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, ensureProfile } from '../profile';
import { HttpError } from '../http';
import { getUserPlan } from '../plan';
import { planLimit } from '../plans';
import * as db from '../db';

// Profile management — full port of backend/routes/profiles.js. Profiles belong to the
// authenticated user (UNIQUE(user_id, name)); data is scoped by profile_id.
export const profilesRoutes = new Hono<AppEnv>();

// Every table carrying a profile_id — cascade targets for delete / data reset.
const PROFILE_TABLES = [
  'transactions',
  'categories',
  'category_mappings',
  'accounts',
  'budgets',
  'budgets_zero_based',
  'savings_goals',
  'loans',
  'bills',
  'housings',
  'recurring_transactions',
  'tags',
  'portfolio_holdings',
  'receipts',
  'retirement_goals',
  'emergency_fund_config',
] as const;

const DEFAULT_CATEGORIES = [
  { name: 'Housing', color: '#ef4444', icon: 'home', type: 'expense' },
  { name: 'Food & Dining', color: '#f97316', icon: 'utensils', type: 'expense' },
  { name: 'Transportation', color: '#eab308', icon: 'car', type: 'expense' },
  { name: 'Healthcare', color: '#22c55e', icon: 'heart', type: 'expense' },
  { name: 'Entertainment', color: '#06b6d4', icon: 'film', type: 'expense' },
  { name: 'Shopping', color: '#8b5cf6', icon: 'shopping-bag', type: 'expense' },
  { name: 'Utilities', color: '#64748b', icon: 'zap', type: 'expense' },
  { name: 'Education', color: '#ec4899', icon: 'book', type: 'expense' },
  { name: 'Salary', color: '#22c55e', icon: 'briefcase', type: 'income' },
];

async function assertOwned(c: Context<AppEnv>, pid: number): Promise<void> {
  const userId = c.get('userId');
  const owned = await db.first(
    c.env.DB,
    'SELECT id FROM profiles WHERE id = ? AND user_id = ?',
    pid,
    userId
  );
  if (!owned) throw new HttpError(404, 'Profile not found');
}

async function clearProfileData(DB: D1Database, pid: number): Promise<void> {
  for (const t of PROFILE_TABLES) await db.del(DB, t, 'profile_id = ?', pid);
}

async function seedDefaultCategories(DB: D1Database, pid: number): Promise<void> {
  for (const cat of DEFAULT_CATEGORIES) {
    await db.run(
      DB,
      'INSERT INTO categories (name, color, icon, type, tax_deductible, profile_id) VALUES (?, ?, ?, ?, 0, ?)',
      cat.name,
      cat.color,
      cat.icon,
      cat.type,
      pid
    );
  }
}

// GET — the user's profiles with per-profile counts (Settings household view reads the counts).
profilesRoutes.get('/api/profiles', requireAuth, async (c) => {
  const userId = c.get('userId');
  await ensureProfile(c); // never return an empty list — old/profile-less accounts get a default
  const rows = await db.all(
    c.env.DB,
    `SELECT p.id, p.name, p.user_id, p.created_at,
       (SELECT COUNT(*) FROM transactions t WHERE t.profile_id = p.id) AS transaction_count,
       (SELECT COUNT(*) FROM accounts a WHERE a.profile_id = p.id) AS account_count,
       (SELECT COUNT(*) FROM budgets b WHERE b.profile_id = p.id) AS budget_count
     FROM profiles p WHERE p.user_id = ? ORDER BY p.id`,
    userId
  );
  return c.json(rows);
});

// POST — create a profile (names are unique per user).
profilesRoutes.post('/api/profiles', requireAuth, async (c) => {
  const userId = c.get('userId');
  const b = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = (b.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Name is required');
  const dup = await db.first(
    c.env.DB,
    'SELECT id FROM profiles WHERE user_id = ? AND name = ?',
    userId,
    name
  );
  if (dup) throw new HttpError(400, 'A profile with this name already exists');
  // Per-plan profile cap (plans.ts; null = unlimited). Enforced with a conditional INSERT so two
  // concurrent creates can't both slip past a separate COUNT-then-INSERT check (TOCTOU): the row is
  // only inserted while the user is under the limit, and 0 rows changed means the cap was hit.
  const limit = planLimit(await getUserPlan(c), 'profiles');
  const res =
    limit === null
      ? await db.run(c.env.DB, 'INSERT INTO profiles (name, user_id) VALUES (?, ?)', name, userId)
      : await db.run(
          c.env.DB,
          `INSERT INTO profiles (name, user_id)
             SELECT ?, ? WHERE (SELECT COUNT(*) FROM profiles WHERE user_id = ?) < ?`,
          name,
          userId,
          userId,
          limit
        );
  if (limit !== null && !res.meta.changes) {
    throw new HttpError(
      403,
      `Your plan allows up to ${limit} profile${limit === 1 ? '' : 's'}. Upgrade for more.`
    );
  }
  const id = res.meta.last_row_id as number;
  // Return the full profile shape the client validates against — it requires `created_at`.
  const created = await db.first<{ created_at: string }>(
    c.env.DB,
    'SELECT created_at FROM profiles WHERE id = ?',
    id
  );
  return c.json({
    id,
    name,
    user_id: userId,
    created_at: created?.created_at ?? new Date().toISOString(),
    transaction_count: 0,
    account_count: 0,
    budget_count: 0,
  });
});

// PUT + PATCH — rename (shared handler).
const renameProfile = async (c: Context<AppEnv>) => {
  const userId = c.get('userId');
  const pid = parseInt(c.req.param('id') ?? '', 10);
  await assertOwned(c, pid);
  const b = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (b.name !== undefined) {
    const name = b.name.trim();
    if (!name) throw new HttpError(400, 'Name is required');
    await db.run(
      c.env.DB,
      'UPDATE profiles SET name = ? WHERE id = ? AND user_id = ?',
      name,
      pid,
      userId
    );
  }
  const updated = await db.first(
    c.env.DB,
    'SELECT id, name, user_id, created_at FROM profiles WHERE id = ?',
    pid
  );
  return c.json(updated);
};
profilesRoutes.put('/api/profiles/:id', requireAuth, renameProfile);
profilesRoutes.patch('/api/profiles/:id', requireAuth, renameProfile);

// DELETE — remove a profile and all its data (never the user's last profile).
profilesRoutes.delete('/api/profiles/:id', requireAuth, async (c) => {
  const userId = c.get('userId');
  const pid = parseInt(c.req.param('id') ?? '', 10);
  await assertOwned(c, pid);
  const count = await db.first<{ n: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?',
    userId
  );
  if ((count?.n ?? 0) <= 1) throw new HttpError(400, 'Cannot delete your only profile');
  await clearProfileData(c.env.DB, pid);
  await db.del(c.env.DB, 'settings', 'profile_id = ?', pid);
  await db.del(c.env.DB, 'profiles', 'id = ? AND user_id = ?', pid, userId);
  return c.json({ ok: true });
});

// DELETE — wipe the active profile's data, keep the profile, reseed default categories.
profilesRoutes.delete('/api/profile/data', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  await clearProfileData(c.env.DB, pid);
  await seedDefaultCategories(c.env.DB, pid);
  return c.json({ ok: true, message: 'Profile data reset successfully' });
});

// POST — "reseed demo": the worker has no 3-tier demo dataset, so this is a data reset with
// default categories (the rich demo lives in client-only mode's IndexedDB seed).
profilesRoutes.post('/api/profiles/reseed-demo', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  await clearProfileData(c.env.DB, pid);
  await seedDefaultCategories(c.env.DB, pid);
  return c.json({ ok: true, message: 'Profile reset with default categories' });
});
