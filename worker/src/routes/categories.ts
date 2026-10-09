import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import { accept, HttpError, refuse } from '../http';
import * as db from '../db';
import { deleteProfileCategory, resetProfileCategories } from '../profileData';
import {
  CATEGORY_MESSAGES,
  categoryNameTaken,
  checkCategoryCreate,
  checkCategoryEdit,
  clashingCategoryName,
  renamesCategory,
} from '../../../shared/categorySchema';
import {
  autoMapDescription,
  autoMapsByDescription,
  CATEGORY_MAPPING_MESSAGES,
  checkApplyMappings,
  checkAutoMap,
  checkCategoryMapping,
  DEFAULT_MAPPING_CONFIDENCE,
  foreignMappingCategory,
  learnedPattern,
} from '../../../shared/categoryMappingSchema';
import type { CategoryMappingInput } from '../../../shared/categoryMappingSchema';
import { suggestCategory } from '../../../shared/autoCategorize';
import type { LearnedMapping, MatchCategory } from '../../../shared/autoCategorize';

// Port of backend/routes/categories.js (repo: backend/repositories/categoriesRepo.js).
// Tables: categories, category_mappings. The backend's toCamelCase() is an identity
// function, so every response below stays snake_case to match the Express API exactly.
//
// Route order mirrors the backend: the literal /mappings and collection routes are
// registered before the /:id routes so 'mappings' is never captured as an :id.
export const categoriesRoutes = new Hono<AppEnv>();

// ── Categories: list (listFull, with parent_name join) ────────────────────────
categoriesRoutes.get('/api/categories', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const ph = pids.map(() => '?').join(',');

  // type/income/expense query params narrow by category type.
  const type = c.req.query('type');
  const income = c.req.query('income');
  const expense = c.req.query('expense');
  const types: string[] = [];
  if (type === 'income' || income === 'true') types.push('income');
  if (type === 'expense' || expense === 'true') types.push('expense');

  let sql = `SELECT c.id, c.name, c.color, c.icon, c.type, c.parent_id, c.tax_deductible, c.created_at, c.profile_id, p.name as parent_name
             FROM categories c
             LEFT JOIN categories p ON c.parent_id = p.id AND p.profile_id = c.profile_id
             WHERE c.profile_id IN (${ph})`;
  const params: unknown[] = [...pids];
  if (types.length > 0) {
    const typePh = types.map(() => '?').join(',');
    sql += ` AND c.type IN (${typePh})`;
    params.push(...types);
  }
  sql += ' ORDER BY c.type, c.name';

  const rows = await db.all(c.env.DB, sql, ...params);
  return c.json(rows);
});

/** The profile's categories, for the duplicate-name check both runtimes share. */
function profileCategoryNames(DB: D1Database, pid: number) {
  return db.all<{ id: number; name: string }>(
    DB,
    'SELECT id, name FROM categories WHERE profile_id = ?',
    pid
  );
}

categoriesRoutes.post('/api/categories', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  // The rules and their wording are shared with local-first: shared/categorySchema.ts. A blank
  // icon, color or type takes its default; anything else wrong is a 400 naming its field.
  const input = accept(checkCategoryCreate(await c.req.json()));
  // A parent from another profile is a field the form got wrong, so it is refused at that field,
  // as local-first refuses it.
  if (
    input.parent_id !== null &&
    !(await db.categoryBelongsToProfile(c.env.DB, input.parent_id, pid))
  ) {
    throw refuse({ parent_id: CATEGORY_MESSAGES.parent });
  }

  // Case does not make a new name: "food" next to "Food" is refused, as local-first refuses it.
  const clash = clashingCategoryName(await profileCategoryNames(c.env.DB, pid), input.name);
  if (clash !== null) throw refuse(categoryNameTaken(clash));

  const res = await db.insert(c.env.DB, 'categories', {
    name: input.name,
    color: input.color,
    icon: input.icon,
    type: input.type,
    parent_id: input.parent_id,
    tax_deductible: input.tax_deductible ? 1 : 0,
    profile_id: pid,
  });

  return c.json({
    id: res.meta.last_row_id,
    name: input.name,
    color: input.color,
    icon: input.icon,
    type: input.type,
    parent_id: input.parent_id,
    profile_id: pid,
  });
});

// ── Category mappings (learned auto-categorization patterns) ──────────────────
categoriesRoutes.get('/api/categories/mappings', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rows = await db.all(
    c.env.DB,
    `SELECT cm.*, c.name as category_name, c.color as category_color
     FROM category_mappings cm
     JOIN categories c ON cm.category_id = c.id AND c.profile_id = cm.profile_id
     WHERE cm.profile_id = ?
     ORDER BY cm.use_count DESC, cm.confidence DESC, cm.id`,
    pid
  );
  return c.json(rows);
});

/**
 * Saves a mapping, or counts one more use of the one the profile has for that pattern (compared
 * exactly, once trimmed), which then takes the new category and confidence.
 */
async function upsertMapping(
  d1: D1Database,
  pid: number,
  mapping: CategoryMappingInput
): Promise<{ id: number; use_count: number }> {
  const existing = await db.first<{ id: number; use_count: number }>(
    d1,
    'SELECT id, use_count FROM category_mappings WHERE profile_id = ? AND pattern = ?',
    pid,
    mapping.pattern
  );
  if (existing) {
    const useCount = (existing.use_count || 0) + 1;
    await db.run(
      d1,
      'UPDATE category_mappings SET category_id = ?, confidence = ?, use_count = ? WHERE id = ?',
      mapping.category_id,
      mapping.confidence,
      useCount,
      existing.id
    );
    return { id: existing.id, use_count: useCount };
  }
  const res = await db.run(
    d1,
    'INSERT INTO category_mappings (profile_id, pattern, category_id, confidence, use_count) VALUES (?, ?, ?, ?, ?)',
    pid,
    mapping.pattern,
    mapping.category_id,
    mapping.confidence,
    1
  );
  return { id: res.meta.last_row_id, use_count: 1 };
}

// The rules and their words are shared with local-first (shared/categoryMappingSchema.ts).
categoriesRoutes.post('/api/categories/mappings', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const mapping = accept(checkCategoryMapping(await c.req.json().catch(() => null)));
  if (!(await db.categoryBelongsToProfile(c.env.DB, mapping.category_id, pid))) {
    throw refuse({ category_id: CATEGORY_MAPPING_MESSAGES.category });
  }
  return c.json({ ok: true, ...(await upsertMapping(c.env.DB, pid, mapping)) });
});

categoriesRoutes.delete('/api/categories/mappings/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const res = await db.run(
    c.env.DB,
    'DELETE FROM category_mappings WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return c.json({ ok: true });
});

// ── Auto-categorization ────────────────────────────────────────────────────────
// Suggest categories for uncategorized transactions. Port of backend/routes/categories.js POST
// /api/categories/auto-map. The matching (learned mappings, the merchant dictionary, words of a
// category's name) is shared with local-first: shared/autoCategorize.ts.
categoriesRoutes.post('/api/categories/auto-map', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const request = accept(checkAutoMap(await c.req.json().catch(() => null)));

  const categories = await db.all<MatchCategory>(
    c.env.DB,
    'SELECT id, name, color, type FROM categories WHERE profile_id = ? ORDER BY type, name',
    pid
  );
  const learned = await db.all<LearnedMapping>(
    c.env.DB,
    'SELECT id, pattern, category_id, confidence, use_count FROM category_mappings WHERE profile_id = ?',
    pid
  );

  // The listed transactions, or those whose text holds the description, or every one; of them,
  // those without a category or filed under Other.
  let txQuery = `
    SELECT t.id, t.description, t.beneficiary, t.payor, t.amount, c.name as category_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    WHERE t.profile_id = ? AND (t.category_id IS NULL OR c.name = 'Other')
    `;
  let params: unknown[] = [pid];
  if (request.transaction_ids) {
    txQuery += ' AND t.id IN (' + request.transaction_ids.map(() => '?').join(',') + ')';
    params = params.concat(request.transaction_ids);
  } else if (request.description !== null && autoMapsByDescription(request)) {
    const normalizedDesc = autoMapDescription(request.description);
    txQuery += ' AND (LOWER(t.description) LIKE ? OR LOWER(t.beneficiary) LIKE ?)';
    params.push('%' + normalizedDesc + '%', '%' + normalizedDesc + '%');
  }
  txQuery += ' ORDER BY t.id';

  const transactions = await db.all<{
    id: number;
    description: string;
    beneficiary: string | null;
    payor: string | null;
  }>(c.env.DB, txQuery, ...params);

  const proposedMappings: Record<string, unknown>[] = [];
  for (const tx of transactions) {
    const suggestion = suggestCategory(tx, categories, learned);
    if (suggestion) {
      proposedMappings.push({
        transaction_id: tx.id,
        description: tx.description,
        proposed_category_id: suggestion.category_id,
        proposed_category_name: suggestion.category_name,
        proposed_category_color: suggestion.category_color,
        confidence: suggestion.confidence,
      });
    }
  }

  return c.json({
    total: transactions.length,
    mapped: proposedMappings.length,
    mappings: proposedMappings,
  });
});

// Apply confirmed mappings: bulk-update transactions.category_id and upsert learned
// mappings. Port of backend/routes/categories.js POST /api/categories/apply-mappings.
categoriesRoutes.post('/api/categories/apply-mappings', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const entries = accept(checkApplyMappings(await c.req.json().catch(() => null)));
  // Every category first: one that is not the profile's files nothing.
  for (const [index, entry] of entries.entries()) {
    if (!(await db.categoryBelongsToProfile(c.env.DB, entry.category_id, pid))) {
      throw refuse(foreignMappingCategory(index));
    }
  }

  let updated = 0;
  for (const entry of entries) {
    const result = await db.run(
      c.env.DB,
      "UPDATE transactions SET category_id = ?, updated_at = datetime('now') WHERE id = ? AND profile_id = ?",
      entry.category_id,
      entry.transaction_id,
      pid
    );
    if (result.meta.changes > 0) updated++;

    // Learn the text for next time (shared/categoryMappingSchema.ts, learnedPattern).
    const pattern = learnedPattern(entry.pattern);
    if (pattern) {
      await upsertMapping(c.env.DB, pid, {
        pattern,
        category_id: entry.category_id,
        confidence: DEFAULT_MAPPING_CONFIDENCE,
      });
    }
  }

  return c.json({ ok: true, updated });
});

// ── Category CRUD by id (registered after the literal routes above) ───────────
categoriesRoutes.delete('/api/categories', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  await resetProfileCategories(c.env.DB, pid);
  return c.json({ ok: true, message: 'Categories reset to defaults' });
});

categoriesRoutes.get('/api/categories/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const cat = await db.first(
    c.env.DB,
    'SELECT * FROM categories WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!cat) throw new HttpError(404, 'Not found');
  return c.json(cat);
});

categoriesRoutes.put('/api/categories/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const existing = await db.first<Record<string, any>>(
    c.env.DB,
    'SELECT * FROM categories WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, 'Category not found');

  // An edit changes what it sends and keeps every stored field it leaves out. The Categories and
  // Budgets forms send name, type, colour and icon; their swatches send the colour alone. The
  // parent and the tax-deductible flag used to reset to null and 0 on every such edit, and the tax
  // reports read the flag. Only a field whose value the edit changes is checked, by the shared
  // rules: one sent back unchanged is not, so a row saved under older rules (a 3-digit color, a
  // long name) can still be edited (shared/categorySchema.ts).
  const patch = accept(checkCategoryEdit(await c.req.json(), existing));
  if (
    patch.parent_id !== undefined &&
    patch.parent_id !== null &&
    !(await db.categoryBelongsToProfile(c.env.DB, patch.parent_id, pid))
  ) {
    throw refuse({ parent_id: CATEGORY_MESSAGES.parent });
  }
  // A rename may not land on another category's name. A name the edit leaves alone, or changes
  // in case only, is not checked, so a profile that already holds "Coffee" and "coffee" can still
  // edit either of them.
  if (patch.name !== undefined && renamesCategory(existing.name, patch.name)) {
    const others = await profileCategoryNames(c.env.DB, pid);
    const clash = clashingCategoryName(others, patch.name, Number(existing.id));
    if (clash !== null) throw refuse(categoryNameTaken(clash));
  }

  const columns: Record<string, unknown> = { ...patch };
  if (patch.tax_deductible !== undefined) columns.tax_deductible = patch.tax_deductible ? 1 : 0;
  if (Object.keys(columns).length === 0) return c.json({ ok: true });

  const res = await db.update(
    c.env.DB,
    'categories',
    columns,
    'id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return c.json({ ok: true });
});

categoriesRoutes.delete('/api/categories/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = Number(c.req.param('id'));
  const existing = await db.first(
    c.env.DB,
    'SELECT id FROM categories WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, 'Not found');
  await deleteProfileCategory(c.env.DB, pid, id);
  return c.json({ ok: true });
});
