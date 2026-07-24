/**
 * Recurring handlers — IndexedDB-backed implementations
 */
import { transactionInvariantError } from '../../../../../shared/transactionInvariant'
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
  const item = {
    profile_id: pid,
    description: (b.description as string) || '',
    amount: parseFloat(String((b.amount as string | number) || 0)),
    type: (b.type as string) || 'expense',
    frequency: (b.frequency as string) || 'monthly',
    day_of_month: (b.day_of_month as number) || (b.day as number) || 1,
    next_date: (b.next_date as string) || '',
    category_id: (b.category_id as number) || null,
    account_id: (b.account_id as number | null) ?? null,
    transfer_account_id: (b.transfer_account_id as number | null) ?? null,
    notes: (b.notes as string) || '',
    is_active: 1,
    created_at: new Date().toISOString(),
  }
  const invariantError = transactionInvariantError(item)
  if (invariantError) return json({ error: invariantError }, 400)
  const id = await db.add('recurring', item)
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
    if (b.account_id !== undefined) item.account_id = b.account_id
    if (b.transfer_account_id !== undefined) item.transfer_account_id = b.transfer_account_id
    if (b.notes !== undefined) item.notes = b.notes
    if (b.is_active !== undefined) item.is_active = b.is_active ? 1 : 0
  }
  if (item.type !== 'transfer') item.transfer_account_id = null
  const invariantError = transactionInvariantError(item)
  if (invariantError) return json({ error: invariantError }, 400)
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
  const invariantError = transactionInvariantError(item)
  if (invariantError) return json({ error: invariantError }, 400)

  const todayStr = new Date().toISOString().substring(0, 10)
  // Idempotency guard — mirrors the worker: once next_date is in the future the
  // current period is already populated, so a repeat call must not create another
  // transaction (and, now that balances move, must not double-count).
  if (item.next_date && item.next_date > todayStr) {
    return json({ error: 'Recurring transaction already populated for current period' }, 409)
  }
  const date = item.next_date || todayStr

  // Go through the adapter so account balances move via computeBalanceDeltas —
  // which handles a two-legged transfer when both account_id and
  // transfer_account_id are set. Keeps serverless mode consistent with the
  // worker/backend populate (income/expense move one account; a transfer moves
  // From -> To; an account-less recurring stays a pure reminder).
  const pid = await adapter.getCurrentProfileId()
  await adapter.createTransaction({
    profile_id: pid,
    description: item.description,
    amount: item.amount,
    type: item.type,
    category_id: item.category_id,
    date,
    currency: 'EUR',
    reconciled: 0,
    notes: item.notes || '',
    account_id: item.account_id ?? null,
    transfer_account_id: item.transfer_account_id ?? null,
  } as Parameters<typeof adapter.createTransaction>[0])

  // Advance next_date past the populated period — every frequency must move
  // forward so the guard above can engage on the next call.
  const next = new Date(date)
  if (item.frequency === 'daily') next.setDate(next.getDate() + 1)
  else if (item.frequency === 'weekly') next.setDate(next.getDate() + 7)
  else if (item.frequency === 'biweekly') next.setDate(next.getDate() + 14)
  else if (item.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1)
  else next.setMonth(next.getMonth() + 1)
  item.next_date = next.toISOString().substring(0, 10)
  await db.put('recurring', item)

  return json({ ok: true })
}
