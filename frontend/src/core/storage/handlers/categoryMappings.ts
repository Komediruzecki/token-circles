/**
 * Learned category mappings, IndexedDB-backed, by the Worker's rules and words
 * (shared/categoryMappingSchema.ts): a pattern saved again is that mapping counted once more, and
 * the list carries each mapping's category name, most used first.
 */
import {
  CATEGORY_MAPPING_MESSAGES,
  checkCategoryMapping,
  DEFAULT_MAPPING_CONFIDENCE,
} from '../../../../../shared/categoryMappingSchema'
import { getDB } from '../idb'
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
import type { LearnedMapping } from '../../../../../shared/autoCategorize'
import type { CategoryMappingInput } from '../../../../../shared/categoryMappingSchema'

interface StoredMapping {
  id: number
  profile_id: number
  pattern: string
  category_id: number
  confidence?: number
  use_count?: number
  created_at?: string
}

/**
 * A stored mapping as both runtimes answer it. One saved before local-first counted them (no
 * confidence, no use count) reads as the Worker would have stored it: 0.9, used once.
 */
function counted<T extends StoredMapping>(row: T): T & LearnedMapping {
  return {
    ...row,
    confidence: typeof row.confidence === 'number' ? row.confidence : DEFAULT_MAPPING_CONFIDENCE,
    use_count: typeof row.use_count === 'number' ? row.use_count : 1,
  }
}

/** The profile's mappings, counted. */
export async function profileMappings(
  profileId: number
): Promise<(StoredMapping & LearnedMapping)[]> {
  const db = await getDB()
  const rows = (await db.getAllFromIndex(
    'categoryMappings',
    'by_profile',
    profileId
  )) as StoredMapping[]
  return rows.map(counted)
}

/**
 * Saves a mapping, or counts one more use of the one the profile has for that pattern (compared
 * exactly, once trimmed), which then takes the new category and confidence. One IndexedDB
 * transaction, so two saves of a new pattern cannot both add it.
 */
export async function upsertMapping(
  profileId: number,
  mapping: CategoryMappingInput
): Promise<{ id: number; use_count: number }> {
  const db = await getDB()
  const tx = db.transaction('categoryMappings', 'readwrite')
  const rows = (await tx.store.index('by_profile').getAll(profileId)) as StoredMapping[]
  const existing = rows.find((row) => row.pattern === mapping.pattern)
  let answer: { id: number; use_count: number }
  if (existing) {
    const useCount = counted(existing).use_count + 1
    await tx.store.put({
      ...existing,
      category_id: mapping.category_id,
      confidence: mapping.confidence,
      use_count: useCount,
    })
    answer = { id: existing.id, use_count: useCount }
  } else {
    const id = (await tx.store.add({
      profile_id: profileId,
      pattern: mapping.pattern,
      category_id: mapping.category_id,
      confidence: mapping.confidence,
      use_count: 1,
      created_at: new Date().toISOString(),
    })) as number
    answer = { id, use_count: 1 }
  }
  await tx.done
  return answer
}

/**
 * The open profile's mappings whose category it still has, with that category's name and colour:
 * the most used first, then the most sure, as the Worker lists them.
 */
export async function categoryMappingsList(): Promise<Response> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const categories = new Map(
    (
      (await db.getAllFromIndex('categories', 'by_profile', pid)) as {
        id: number
        name: string
        color?: string | null
      }[]
    ).map((category) => [category.id, category])
  )
  const listed = (await profileMappings(pid)).flatMap((mapping) => {
    const category = categories.get(mapping.category_id)
    return category
      ? [{ ...mapping, category_name: category.name, category_color: category.color ?? null }]
      : []
  })
  listed.sort((a, b) => b.use_count - a.use_count || b.confidence - a.confidence || a.id - b.id)
  return json(listed)
}

export async function categoryMappingsCreate(body: unknown): Promise<Response> {
  // The router has already run this check on the way in; a direct call gets the same answer.
  const checked = checkCategoryMapping(body)
  if (!checked.ok) return refuse(checked.fields)
  const pid = await adapter.getCurrentProfileId()
  if (!(await currentProfileOwns('categories', checked.value.category_id, pid))) {
    return refuse({ category_id: CATEGORY_MAPPING_MESSAGES.category })
  }
  return ok(await upsertMapping(pid, checked.value))
}

export async function categoryMappingsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const id = idParam(params)
  if (!(await currentProfileRecord('categoryMappings', id))) {
    return notFound('Category mapping')
  }
  await db.delete('categoryMappings', id)
  return ok()
}
