/**
 * Tags handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, notFound, ok } from './helpers'

export async function tagsList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('tags', 'by_profile', pid)
      all.push(...rows)
    }
    return json(all)
  } catch {
    return json([])
  }
}

export async function tagsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const name = (b.name as string) || ''
  if (!name.trim()) return json({ error: 'Tag name is required' }, 400)
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const id = await db.add('tags', {
    profile_id: pid,
    name: name.trim(),
    color: (b.color as string) || '#6366f1',
    created_at: new Date().toISOString(),
  })
  return json({ id, name: name.trim(), color: (b.color as string) || '#6366f1' }, 201)
}

export async function tagsGetTransactions(params: Record<string, string>): Promise<Response> {
  // Return transactions associated with a tag
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const tagId = idParam(params)
  const allTxns = await db.getAllFromIndex('transactions', 'by_profile', pid)
  const filtered = allTxns.filter((t: Record<string, unknown>) => {
    const tagIds = (t.tag_ids as number[]) || []
    return tagIds.includes(tagId)
  })
  return json(filtered)
}

export async function tagsUpdate(params: Record<string, string>, body: unknown): Promise<Response> {
  const db = await getDB()
  const tag = await db.get('tags', idParam(params))
  if (!tag) return notFound('Tag')
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.name !== undefined) tag.name = (b.name as string).trim()
    if (b.color !== undefined) tag.color = b.color as string
  }
  await db.put('tags', tag)
  return json(tag)
}

export async function tagsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const tag = await db.get('tags', idParam(params))
  if (!tag) return notFound('Tag')
  // Remove tag from all transactions that reference it
  const pids = adapter.getCurrentProfileIds()
  for (const pid of pids) {
    const txns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    for (const t of txns) {
      const tagIds = (t.tag_ids as number[]) || []
      const idx = tagIds.indexOf(idParam(params))
      if (idx !== -1) {
        tagIds.splice(idx, 1)
        t.tag_ids = tagIds
        await db.put('transactions', t)
      }
    }
  }
  await db.delete('tags', idParam(params))
  return ok()
}

export async function transactionTagsGet(params: Record<string, string>): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const txId = idParam(params)
    const tx = await db.get('transactions', txId)
    if (!tx || tx.profile_id !== pid) return notFound('Transaction')
    const tagIds: number[] = tx.tag_ids || []
    if (tagIds.length === 0) return json([])
    const allTags = await db.getAllFromIndex('tags', 'by_profile', pid)
    const result = (allTags as Record<string, unknown>[]).filter((t) =>
      tagIds.includes(t.id as number)
    )
    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function transactionTagsSet(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const txId = idParam(params)
    const tx = await db.get('transactions', txId)
    if (!tx || tx.profile_id !== pid) return notFound('Transaction')
    const data = body as Record<string, unknown>
    const tagIds = data.tagIds as number[] | undefined
    if (!Array.isArray(tagIds)) return json({ error: 'tagIds must be an array' }, 400)
    const updated = {
      ...tx,
      tag_ids: tagIds,
      tags: [] as { id: number; name: string; color: string }[],
    }
    if (tagIds.length > 0) {
      const allTags = await db.getAllFromIndex('tags', 'by_profile', pid)
      updated.tags = (allTags as Record<string, unknown>[])
        .filter((t) => tagIds.includes(t.id as number))
        .map((t) => ({ id: t.id as number, name: t.name as string, color: t.color as string }))
    }
    await db.put('transactions', updated)
    return ok()
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function transactionsByTag(params: Record<string, string>): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const tagId = idParam(params)
    const allTxns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    const filtered = (allTxns as Record<string, unknown>[]).filter((t) => {
      const tagIds = (t.tag_ids as number[]) || []
      return tagIds.includes(tagId)
    })
    return json({ rows: filtered, total: filtered.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
