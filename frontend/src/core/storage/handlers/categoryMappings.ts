/**
 * CategoryMappings handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, ok } from './helpers'

export async function categoryMappingsList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    if (db.objectStoreNames.contains('categoryMappings')) {
      const all: Record<string, unknown>[] = []
      for (const pid of pids) {
        const rows = await db.getAllFromIndex('categoryMappings', 'by_profile', pid)
        all.push(...rows)
      }
      return json(all)
    }
  } catch {
    /* store may not exist yet */
  }
  return json([])
}

export async function categoryMappingsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  if (db.objectStoreNames.contains('categoryMappings')) {
    const id = await db.add('categoryMappings', {
      profile_id: pid,
      pattern: (body as Record<string, unknown>).pattern || '',
      category_id: (body as Record<string, unknown>).category_id || null,
      created_at: new Date().toISOString(),
    })
    return json({ id }, 201)
  }
  return json({ id: 1 }, 201)
}

export async function categoryMappingsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  if (db.objectStoreNames.contains('categoryMappings')) {
    await db.delete('categoryMappings', idParam(params))
  }
  return ok()
}
