import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  checkHousingCreate,
  checkHousingEdit,
  HOUSING_MESSAGES,
  housingAnswer,
  housingRowOf,
} from '../../../shared/housingSchema';
import type { HousingDefaults } from '../../../shared/housingSchema';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { accept, HttpError } from '../http';
import * as db from '../db';
import { localMonth } from '../local-date';

// Port of backend/routes/housing.js (repo: backend/repositories/housingRepo.js).
// Table: housings. The backend file is pure CRUD — there is no mortgage/affordability
// calculator endpoint to port. Responses stay snake_case to match the Express API.
// A body is checked by shared/housingSchema.ts, as local-first checks it.
export const housingRoutes = new Hono<AppEnv>();

/** A body without a due month falls due in the person's current month. */
function housingDefaults(c: Context<AppEnv>): HousingDefaults {
  return { month: Number(localMonth(c).slice(5, 7)) };
}

housingRoutes.get('/api/housing', requireAuth, async (c) => {
  const pid = await getProfileId(c);

  // Custom ordering by due_date ASC (the repo default is created_at DESC).
  const housings = await db.all<Record<string, any>>(
    c.env.DB,
    `SELECT id, name, type, monthly_amount, due_date, autopay, notes, created_at
     FROM housings WHERE profile_id = ? ORDER BY due_date ASC`,
    pid
  );

  const totalMonthly = housings.reduce(
    (sum, h) => sum + Math.abs(parseFloat(h.monthly_amount) || 0),
    0
  );

  return c.json({
    housings: housings.map((h) => housingAnswer({ ...h, profile_id: pid })),
    total_monthly: Math.round(totalMonthly),
  });
});

housingRoutes.post('/api/housing', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const row = housingRowOf(accept(checkHousingCreate(await c.req.json(), housingDefaults(c))));

  const res = await db.insert(c.env.DB, 'housings', {
    profile_id: pid,
    ...row,
    autopay: row.autopay ? 1 : 0,
  });

  return c.json({ id: res.meta.last_row_id }, 201);
});

housingRoutes.put('/api/housing/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const b: unknown = await c.req.json();

  const existing = await db.first<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM housings WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, HOUSING_MESSAGES.notFound);

  // Only what the edit changes is checked and written (decision 2): a field left out stays.
  const edit = accept(checkHousingEdit(b, existing, housingDefaults(c)));
  const values: Record<string, unknown> = { ...edit };
  if (edit.autopay !== undefined) values.autopay = edit.autopay ? 1 : 0;
  if (Object.keys(values).length > 0) {
    await db.update(c.env.DB, 'housings', values, 'id = ? AND profile_id = ?', id, pid);
  }

  return c.json({ success: true });
});

housingRoutes.delete('/api/housing/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');

  const existing = await db.first(
    c.env.DB,
    'SELECT id FROM housings WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, HOUSING_MESSAGES.notFound);

  await db.del(c.env.DB, 'housings', 'id = ? AND profile_id = ?', id, pid);
  return c.json({ success: true });
});
