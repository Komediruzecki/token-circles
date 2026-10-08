import { Hono } from 'hono';
import {
  checkContribution,
  checkGoalCreate,
  checkGoalEdit,
  GOAL_MESSAGES,
} from '../../../shared/goalSchema';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import { accept, HttpError, refuse } from '../http';
import { recalcAllGoals, recalcGoalsByCategory } from '../recalc-goals';
import * as db from '../db';
import { localToday } from '../local-date';

// Reference port of backend/routes/savingsGoals.js. This is the canonical pattern
// for a profile-scoped CRUD resource: requireAuth -> getProfileId -> async D1.
export const savingsGoalsRoutes = new Hono<AppEnv>();

savingsGoalsRoutes.get('/api/savings-goals', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  // Refresh category-linked progress on load so the page never shows a stale amount.
  // Best-effort: if the recompute fails, still return the stored values rather than 500.
  try {
    await recalcAllGoals(c.env.DB, pids);
  } catch (e) {
    console.error('recalcAllGoals failed', e);
  }
  const ph = pids.map(() => '?').join(',');
  const rows = await db.all(
    c.env.DB,
    `SELECT * FROM savings_goals WHERE profile_id IN (${ph}) ORDER BY id`,
    ...pids
  );
  return c.json(rows);
});

// The rules and their words are shared/goalSchema.ts, which local-first and the Goals dialog run
// too: a refused body answers 400 { error, fields }, and a category of another profile is a 400 at
// `category_id` (it was a 403 with no field). The date may come as `deadline`, the column, or
// `target_date`, the name the Goals form sends.
savingsGoalsRoutes.post('/api/savings-goals', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const goal = accept(checkGoalCreate(await c.req.json(), { today: localToday(c) }));
  if (
    goal.category_id !== null &&
    !(await db.categoryBelongsToProfile(c.env.DB, goal.category_id, pid))
  ) {
    throw refuse({ category_id: GOAL_MESSAGES.category });
  }
  const res = await db.insert(c.env.DB, 'savings_goals', { ...goal, profile_id: pid });
  // Compute progress now so a category-linked goal shows the right starting value.
  if (goal.category_id) await recalcGoalsByCategory(c.env.DB, goal.category_id, [pid]);
  return c.json({ id: res.meta.last_row_id }, 201);
});

// An edit checks and writes only the fields whose value it changes (decision 2), so a goal an
// older version stored under other rules can still be renamed.
savingsGoalsRoutes.put('/api/savings-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const existing = await db.first<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM savings_goals WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, 'Not found');
  const fields = accept(checkGoalEdit(await c.req.json(), existing));
  if (
    fields.category_id != null &&
    !(await db.categoryBelongsToProfile(c.env.DB, fields.category_id, pid))
  ) {
    throw refuse({ category_id: GOAL_MESSAGES.category });
  }
  if (Object.keys(fields).length === 0) return c.json({ ok: true });

  await db.update(c.env.DB, 'savings_goals', fields, 'id = ? AND profile_id = ?', id, pid);
  // Category link or tracking window may have changed — recompute progress.
  const catId =
    fields.category_id !== undefined
      ? fields.category_id
      : ((existing.category_id as number | null) ?? null);
  if (catId) await recalcGoalsByCategory(c.env.DB, catId, [pid]);
  return c.json({ ok: true });
});

savingsGoalsRoutes.delete('/api/savings-goals/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const res = await db.del(
    c.env.DB,
    'savings_goals',
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return c.json({ ok: true });
});

// A contribution is an amount more than zero, to the cent. One the Worker could not read as a
// number added nothing and answered that it had. The sum is worked out in the UPDATE, so two
// contributions at once both count.
savingsGoalsRoutes.post('/api/savings-goals/:id/contribute', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const goal = await db.first<{ id: number }>(
    c.env.DB,
    'SELECT id FROM savings_goals WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!goal) throw new HttpError(404, 'Goal not found');
  const { amount } = accept(checkContribution(await c.req.json()));
  // A write, so db.run: it retries only what never ran, never a blip after the commit.
  await db.run(
    c.env.DB,
    `UPDATE savings_goals SET current_amount = ROUND(COALESCE(current_amount, 0) + ?, 2)
      WHERE id = ? AND profile_id = ?`,
    amount,
    id,
    pid
  );
  const saved = await db.first<{ current_amount: number }>(
    c.env.DB,
    'SELECT current_amount FROM savings_goals WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  return c.json({ ok: true, current_amount: saved?.current_amount ?? amount });
});
