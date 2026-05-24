/**
 * Recurring handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, notFound, ok } from './helpers'

export async function recurringList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('recurring', 'by_profile', pid)
      all.push(...rows)
    }
    return json(all)
  } catch {
    return json([])
  }
}

export async function recurringGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const item = await db.get('recurring', idParam(params))
  if (!item) return notFound('Recurring transaction')
  return json(item)
}

export async function recurringCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const id = await db.add('recurring', {
    profile_id: pid,
    description: (b.description as string) || '',
    amount: parseFloat(String((b.amount as string | number) || 0)),
    type: (b.type as string) || 'expense',
    frequency: (b.frequency as string) || 'monthly',
    day_of_month: (b.day_of_month as number) || (b.day as number) || 1,
    next_date: (b.next_date as string) || '',
    category_id: (b.category_id as number) || null,
    notes: (b.notes as string) || '',
    is_active: 1,
    created_at: new Date().toISOString(),
  })
  return json({ id, profile_id: pid }, 201)
}

export async function recurringUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const item = await db.get('recurring', idParam(params))
  if (!item) return notFound('Recurring transaction')
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.description !== undefined) item.description = b.description
    if (b.amount !== undefined) item.amount = parseFloat(String((b.amount as string | number) || 0))
    if (b.type !== undefined) item.type = b.type
    if (b.frequency !== undefined) item.frequency = b.frequency
    if (b.day_of_month !== undefined) item.day_of_month = b.day_of_month
    if (b.day !== undefined) item.day_of_month = b.day
    if (b.next_date !== undefined) item.next_date = b.next_date
    if (b.category_id !== undefined) item.category_id = b.category_id
    if (b.notes !== undefined) item.notes = b.notes
    if (b.is_active !== undefined) item.is_active = b.is_active ? 1 : 0
  }
  await db.put('recurring', item)
  return ok()
}

export async function recurringDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  await db.delete('recurring', idParam(params))
  return ok()
}

export async function recurringUpcoming(): Promise<Response> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  try {
    const all = await db.getAllFromIndex('recurring', 'by_profile', pid)
    const active = all.filter((r: Record<string, unknown>) => r.is_active !== 0)
    return json(active)
  } catch {
    return json([])
  }
}

export async function recurringPopulate(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const item = await db.get('recurring', idParam(params))
  if (!item) return notFound('Recurring transaction')

  // Create a transaction from the recurring template
  const pid = await adapter.getCurrentProfileId()
  const accountId = item.account_id || null
  await db.add('transactions', {
    profile_id: pid,
    description: item.description,
    amount: item.amount,
    type: item.type,
    category_id: item.category_id,
    date: new Date().toISOString().substring(0, 10),
    currency: 'EUR',
    reconciled: 0,
    notes: item.notes || '',
    account_id: accountId,
  })

  // Update next_date
  const nextDate = new Date()
  if (item.frequency === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1)
  else if (item.frequency === 'weekly') nextDate.setDate(nextDate.getDate() + 7)
  else if (item.frequency === 'biweekly') nextDate.setDate(nextDate.getDate() + 14)
  else nextDate.setMonth(nextDate.getMonth() + 1)
  item.next_date = nextDate.toISOString().substring(0, 10)
  await db.put('recurring', item)

  return json({ ok: true })
}
