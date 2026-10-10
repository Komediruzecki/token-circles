/**
 * Tags handlers — IndexedDB-backed implementations
 *
 * A tag's name and colour, and the tags put on a transaction, are checked by shared/tagSchema.ts,
 * as the Worker checks them.
 */
import {
  checkTagCreate,
  checkTagEdit,
  clashingTagName,
  defaultTagColor,
  readTagIds,
  renamesTag,
  TAG_MESSAGES,
  tagNameTaken,
} from '../../../../../shared/tagSchema'
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

/**
 * The active profile's tags, as the Worker lists them. A tag belongs to one profile everywhere
 * else too (the Tags page, rules, attaching one to a row), and this list used to span the
 * household: in household view the Transactions page offered tags that no write there accepts,
 * and two chips that read the same wherever two profiles had a tag of one name.
 */
export async function tagsList(): Promise<Response> {
  const db = await getDB()
  try {
    const pid = await adapter.getCurrentProfileId()
    return json(await db.getAllFromIndex('tags', 'by_profile', pid))
  } catch {
    return json([])
  }
}

export async function tagsCreate(body: unknown): Promise<Response> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const own = (await db.getAllFromIndex('tags', 'by_profile', pid)) as {
    id: number
    name: unknown
  }[]
  // Sent without a colour, a tag takes the one the Tags page offers the profile's next tag.
  const checked = checkTagCreate(body, defaultTagColor(own.length))
  if (!checked.ok) return refuse(checked.fields)
  const { name, color } = checked.value
  // The Worker's table is UNIQUE(name, profile_id): a second tag of one name is refused in both.
  const taken = clashingTagName(own, name)
  if (taken !== null) return refuse(tagNameTaken(taken))
  const id = await db.add('tags', {
    profile_id: pid,
    name,
    color,
    created_at: new Date().toISOString(),
  })
  return json({ id, name, color }, 201)
}

export async function tagsGetTransactions(params: Record<string, string>): Promise<Response> {
  // Return transactions associated with a tag
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const tagId = idParam(params)
  if (!(await currentProfileRecord('tags', tagId))) return notFound('Tag')
  const allTxns = await db.getAllFromIndex('transactions', 'by_profile', pid)
  const filtered = allTxns.filter((t: Record<string, unknown>) => {
    const tagIds = (t.tag_ids as number[]) || []
    return tagIds.includes(tagId)
  })
  return json(filtered)
}

export async function tagsUpdate(params: Record<string, string>, body: unknown): Promise<Response> {
  const db = await getDB()
  const tagId = idParam(params)
  const tag = await currentProfileRecord('tags', tagId)
  if (!tag) return notFound('Tag')
  // Only what the edit changes is checked and written: a colour left out stays as it is.
  const checked = checkTagEdit(body, tag)
  if (!checked.ok) return refuse(checked.fields)
  const edit = checked.value
  if (edit.name !== undefined) {
    const own = (await db.getAllFromIndex('tags', 'by_profile', tag.profile_id)) as {
      id: number
      name: unknown
    }[]
    const taken = clashingTagName(own, edit.name, tagId, !renamesTag(tag.name, edit.name))
    if (taken !== null) return refuse(tagNameTaken(taken))
  }
  Object.assign(tag, edit)
  await db.put('tags', tag)

  // Transactions carry a denormalized copy of their tags (see transactionTagsSet), so a rename
  // or recolor has to be written through — otherwise the table keeps rendering the old label.
  const pid = await adapter.getCurrentProfileId()
  const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Record<
    string,
    any
  >[]
  for (const t of txns) {
    const copies = (t.tags as { id: number; name: string; color: string }[]) || []
    if (!copies.some((copy) => copy.id === tagId)) continue
    t.tags = copies.map((copy) =>
      copy.id === tagId ? { id: tagId, name: tag.name, color: tag.color } : copy
    )
    await db.put('transactions', t)
  }
  return json(tag)
}

export async function tagsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const tagId = idParam(params)
  const tag = await currentProfileRecord('tags', tagId)
  if (!tag) return notFound('Tag')
  // Remove tag from all transactions that reference it — both the id list and the
  // denormalized copy the table renders from.
  const pid = await adapter.getCurrentProfileId()
  const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Record<
    string,
    any
  >[]
  for (const t of txns) {
    const tagIds = (t.tag_ids as number[]) || []
    const copies = (t.tags as { id: number }[]) || []
    const idx = tagIds.indexOf(tagId)
    const hasCopy = copies.some((copy) => copy.id === tagId)
    if (idx === -1 && !hasCopy) continue
    if (idx !== -1) {
      tagIds.splice(idx, 1)
      t.tag_ids = tagIds
    }
    if (hasCopy) t.tags = copies.filter((copy) => copy.id !== tagId)
    await db.put('transactions', t)
  }
  // Drop the tag's rules too, so a deleted tag can't keep auto-tagging new transactions.
  if (db.objectStoreNames.contains('tagRules')) {
    const rules = (await db.getAllFromIndex('tagRules', 'by_tag', tagId)) as Record<string, any>[]
    for (const rule of rules) {
      if (rule.profile_id === pid) await db.delete('tagRules', rule.id as number)
    }
  }
  await db.delete('tags', tagId)
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
    const read = readTagIds((body as Record<string, unknown> | null)?.tagIds)
    if (!read.ok) return refuse(read.fields)
    const tagIds = read.value
    for (const tagId of tagIds) {
      // Another profile's tag is refused at the field, as the Worker refuses it.
      if (!(await currentProfileOwns('tags', tagId))) return refuse({ tagIds: TAG_MESSAGES.tagIds })
    }
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

/**
 * A tag's transactions, as the Worker answers them: newest first (the later id first on one day),
 * narrowed by startDate, endDate, category_ids (a comma list), type, limit (at most 1000) and
 * offset, each with its category's name, colour and icon. `total` counts the rows answered.
 */
export async function transactionsByTag(
  params: Record<string, string>,
  query: URLSearchParams = new URLSearchParams()
): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const tagId = idParam(params)
    const startDate = query.get('startDate')
    const endDate = query.get('endDate')
    const type = query.get('type')
    const categoryIds = (query.get('category_ids') ?? '')
      .split(',')
      .filter((part) => part.trim() !== '')
      .map(Number)
      .filter((n) => !Number.isNaN(n))
    const allTxns = (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Record<
      string,
      any
    >[]
    const day = (t: Record<string, any>) => String(t.date ?? '').slice(0, 10)
    const tagged = allTxns
      .filter((t) => ((t.tag_ids as number[]) || []).includes(tagId))
      .filter((t) => !startDate || day(t) >= startDate)
      .filter((t) => !endDate || day(t) <= endDate)
      .filter((t) => categoryIds.length === 0 || categoryIds.includes(Number(t.category_id)))
      .filter((t) => !type || t.type === type)
      .sort((a, b) => day(b).localeCompare(day(a)) || Number(b.id) - Number(a.id))
    const limit = parseInt(query.get('limit') ?? '', 10)
    const offset = parseInt(query.get('offset') ?? '', 10)
    const from = Number.isNaN(offset) ? 0 : Math.max(0, offset)
    // As SQLite reads LIMIT and OFFSET: a negative limit is none, a negative offset is 0.
    const to = Number.isNaN(limit) || limit < 0 ? undefined : from + Math.min(limit, 1000)
    const categories = new Map(
      ((await db.getAllFromIndex('categories', 'by_profile', pid)) as Record<string, any>[]).map(
        (c) => [Number(c.id), c]
      )
    )
    const rows = tagged.slice(from, to).map((t) => {
      const category = categories.get(Number(t.category_id))
      return {
        ...t,
        category_name: category?.name ?? null,
        category_color: category?.color ?? null,
        category_icon: category?.icon ?? null,
      }
    })
    return json({ rows, total: rows.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
