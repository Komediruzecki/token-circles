/**
 * Categories handlers — IndexedDB-backed implementations
 */
import { suggestCategory } from '../../../../../shared/autoCategorize'
import {
  autoMapDescription,
  autoMapsByDescription,
  checkApplyMappings,
  checkAutoMap,
  DEFAULT_MAPPING_CONFIDENCE,
  foreignMappingCategory,
  learnedPattern,
} from '../../../../../shared/categoryMappingSchema'
import {
  CATEGORY_MESSAGES,
  categoryNameTaken,
  checkCategoryCreate,
  checkCategoryEdit,
  clashingCategoryName,
  renamesCategory,
} from '../../../../../shared/categorySchema'
import { getDB } from '../idb'
import { profileMappings, upsertMapping } from './categoryMappings'
import { recalcGoalsByCategory } from './goals'
import {
  adapter,
  currentProfileOwns,
  currentProfileRecord,
  idParam,
  json,
  notFound,
  ok,
  refuse,
} from './helpers'
import { normalizeCategory } from './normalize'
import type { MatchCategory } from '../../../../../shared/autoCategorize'

export async function categoriesList(query: URLSearchParams): Promise<Response> {
  const type = query.get('type') as 'income' | 'expense' | undefined
  const cats = await adapter.listCategories(type)
  return json(cats.map(normalizeCategory))
}

export async function categoriesCreate(body: unknown): Promise<Response> {
  // The Worker's rules and words (shared/categorySchema.ts). The router has already run this
  // check on the way in; a direct call (tests, other handlers) gets the same answer.
  const checked = checkCategoryCreate(body)
  if (!checked.ok) return refuse(checked.fields)
  const input = checked.value

  const pid = await adapter.getCurrentProfileId()
  // A parent from another profile is refused at that field, as the Worker refuses it.
  if (!(await currentProfileOwns('categories', input.parent_id))) {
    return refuse({ parent_id: CATEGORY_MESSAGES.parent })
  }

  const db = await getDB()
  const existing = await db.getAllFromIndex('categories', 'by_profile', pid)
  const clash = clashingCategoryName(existing as { id: unknown; name: unknown }[], input.name)
  if (clash !== null) return refuse(categoryNameTaken(clash))

  // The row the Worker stores, not the body as it came: the check filled in every default, so no
  // row can miss a field CategorySchema needs on the next typed read.
  const row = { ...input, created_at: new Date().toISOString(), profile_id: pid }
  const id = await adapter.createCategory(
    row as unknown as Parameters<typeof adapter.createCategory>[0]
  )
  return json({ id, ...row }, 201)
}

export async function categoriesGet(params: Record<string, string>): Promise<Response> {
  const cat = await currentProfileRecord('categories', idParam(params))
  if (!cat) return notFound('Category')
  return json(normalizeCategory(cat))
}

export async function categoriesUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const id = idParam(params)
  const current = await currentProfileRecord('categories', id)
  if (!current) return notFound('Category')
  // Only the category fields the body changes, checked as the Worker checks them. A field it
  // leaves out keeps its value, and so does one it sends back unchanged: that one is not checked
  // either, so a row saved under older rules (a 3-digit color, a long name) can still be edited.
  // Keys that are not category fields are not written into the row.
  const checked = checkCategoryEdit(body, current)
  if (!checked.ok) {
    // The router logs this for every body its checks refuse, and the release suite fails a
    // local-first run that shows one (tests/release/release-fixtures.ts). An edit is checked here,
    // against the stored row, so it is said here.
    console.error('[categoriesUpdate] Validation failed', { id, body, fields: checked.fields })
    return refuse(checked.fields)
  }
  const patch = checked.value
  if (patch.parent_id !== undefined && !(await currentProfileOwns('categories', patch.parent_id))) {
    return refuse({ parent_id: CATEGORY_MESSAGES.parent })
  }
  // A rename may not land on another category's name. A name the edit leaves alone, or changes
  // in case only, is not checked.
  if (patch.name !== undefined && renamesCategory(current.name, patch.name)) {
    const db = await getDB()
    const others = await db.getAllFromIndex('categories', 'by_profile', current.profile_id)
    const clash = clashingCategoryName(others as { id: unknown; name: unknown }[], patch.name, id)
    if (clash !== null) return refuse(categoryNameTaken(clash))
  }
  if (Object.keys(patch).length > 0) {
    await adapter.updateCategory(id, patch as Parameters<typeof adapter.updateCategory>[1])
  }
  return ok()
}

export async function categoriesDelete(params: Record<string, string>): Promise<Response> {
  const id = idParam(params)
  if (!(await currentProfileRecord('categories', id))) return notFound('Category')
  await adapter.deleteCategory(id)
  return ok()
}

/** The text auto-map narrows to, read as SQLite's LIKE on a lowered column reads it. */
function holds(value: unknown, part: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(part)
}

/**
 * Suggests a category for each uncategorised transaction (none, or Other) and files nothing, as
 * the Worker does: the listed ones, or those whose text holds a description, or every one. The
 * matching is shared/autoCategorize.ts.
 */
export async function categoriesAutoMap(body: unknown): Promise<Response> {
  const checked = checkAutoMap(body)
  if (!checked.ok) return refuse(checked.fields)
  const request = checked.value
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const categories = (await db.getAllFromIndex('categories', 'by_profile', pid)) as MatchCategory[]
  const names = new Map(categories.map((category) => [category.id, category.name]))
  const learned = await profileMappings(pid)

  const ids = request.transaction_ids ? new Set(request.transaction_ids) : null
  const description =
    request.description !== null && autoMapsByDescription(request)
      ? autoMapDescription(request.description)
      : null
  const rows = (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Record<
    string,
    unknown
  >[]
  const targets = rows
    .filter((tx) => {
      const categoryId = tx.category_id as number | null | undefined
      if (categoryId && names.get(categoryId) !== 'Other') return false
      if (ids) return ids.has(tx.id as number)
      if (description !== null) {
        return holds(tx.description, description) || holds(tx.beneficiary, description)
      }
      return true
    })
    .sort((a, b) => (a.id as number) - (b.id as number))

  const mappings: Record<string, unknown>[] = []
  for (const tx of targets) {
    const suggestion = suggestCategory(tx, categories, learned)
    if (suggestion) {
      mappings.push({
        transaction_id: tx.id,
        description: tx.description ?? null,
        proposed_category_id: suggestion.category_id,
        proposed_category_name: suggestion.category_name,
        proposed_category_color: suggestion.category_color ?? null,
        confidence: suggestion.confidence,
      })
    }
  }
  return json({ total: targets.length, mapped: mappings.length, mappings })
}

/**
 * Files each listed transaction under its category and learns its pattern, as the Worker does:
 * every category must be the profile's, or nothing is filed; a transaction that is not the
 * profile's is skipped.
 */
export async function categoriesApplyMappings(body: unknown): Promise<Response> {
  const checked = checkApplyMappings(body)
  if (!checked.ok) return refuse(checked.fields)
  const pid = await adapter.getCurrentProfileId()
  for (const [index, entry] of checked.value.entries()) {
    if (!(await currentProfileOwns('categories', entry.category_id, pid))) {
      return refuse(foreignMappingCategory(index))
    }
  }

  let updated = 0
  // The categories filed transactions leave and join.
  const moved = new Set<number>()
  for (const entry of checked.value) {
    const transaction = await currentProfileRecord('transactions', entry.transaction_id, pid)
    if (transaction) {
      await adapter.updateTransaction(entry.transaction_id, { category_id: entry.category_id })
      updated++
      if (transaction.category_id) moved.add(transaction.category_id as number)
      moved.add(entry.category_id)
    }
    // Learn the text for next time (shared/categoryMappingSchema.ts, learnedPattern).
    const pattern = learnedPattern(entry.pattern)
    if (pattern) {
      await upsertMapping(pid, {
        pattern,
        category_id: entry.category_id,
        confidence: DEFAULT_MAPPING_CONFIDENCE,
      })
    }
  }
  // A goal linked to a category follows its transactions, as on every other path that moves them.
  for (const categoryId of moved) await recalcGoalsByCategory(categoryId)
  return ok({ updated })
}
