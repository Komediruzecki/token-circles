/**
 * Profiles handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, notFound, ok } from './helpers'

export async function profilesList(): Promise<Response> {
  const db = await getDB()
  // Ensure the first-run demo seed has happened before reading, so every caller (the sidebar
  // dropdown and the Settings household view) sees the same data regardless of call timing.
  await adapter.getCurrentProfileId().catch(() => {})
  const profiles = await db.getAll('profiles')

  // Compute per-profile counts for the Settings Household Overview table
  const result = await Promise.all(
    profiles.map(async (p: { id: number; name: string }) => {
      const pid = p.id
      let txCount = 0
      let acctCount = 0
      let budgetCount = 0
      try {
        txCount = await db.countFromIndex('transactions', 'by_profile', pid)
      } catch {
        /* store may not exist */
      }
      try {
        acctCount = await db.countFromIndex('accounts', 'by_profile', pid)
      } catch {
        /* store may not exist */
      }
      try {
        budgetCount = await db.countFromIndex('budgets', 'by_profile', pid)
      } catch {
        /* store may not exist */
      }
      return {
        ...p,
        // Backfill created_at for profiles saved before the field existed — otherwise the
        // client's ProfileSchema (which requires created_at) rejects the whole list.
        created_at: (p as { created_at?: string }).created_at || new Date().toISOString(),
        transaction_count: txCount,
        account_count: acctCount,
        budget_count: budgetCount,
      }
    })
  )

  return json(result)
}

export async function profilesCreate(body: unknown): Promise<Response> {
  if (body && typeof body === 'object' && 'name' in body) {
    const name = (((body as Record<string, unknown>).name as string) || '').trim()
    if (!name) return json({ error: 'Profile name is required' }, 400)
    const db = await getDB()
    const existing = await db.getAll('profiles')
    if (existing.some((p: Record<string, unknown>) => (p.name as string) === name)) {
      return json({ error: 'A profile with this name already exists' }, 400)
    }
    const id = await adapter.createProfile(name)
    return json({ id, name, created_at: new Date().toISOString() }, 201)
  }
  return json({ error: 'Name required' }, 400)
}

export async function profilesGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const profile = await db.get('profiles', idParam(params))
  if (!profile) return notFound('Profile')
  return json(profile)
}

export async function profilesUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (body && typeof body === 'object' && 'name' in body) {
    await adapter.updateProfile(idParam(params), (body as Record<string, unknown>).name as string)
    return ok()
  }
  return json({ error: 'Name required' }, 400)
}

export async function profilesDelete(params: Record<string, string>): Promise<Response> {
  const profileId = idParam(params)
  // Verify the profile exists and is owned by the current user
  const db = await getDB()
  const profile = await db.get('profiles', profileId)
  if (!profile) return notFound('Profile')
  const pids = adapter.getCurrentProfileIds()
  if (!pids.includes(profileId))
    return json({ error: 'Cannot delete a profile you do not own' }, 403)

  // Cascade delete all data belonging to this profile
  const stores = [
    'transactions',
    'categories',
    'accounts',
    'budgets',
    'goals',
    'loans',
    'balanceHistory',
    'bills',
    'housings',
    'recurring',
    'tags',
    'portfolioHoldings',
    'receipts',
  ]
  for (const store of stores) {
    if (!db.objectStoreNames.contains(store)) continue
    const all = await db.getAll(store)
    for (const item of all) {
      if (item.profile_id === profileId) {
        await db.delete(store, item.id as number)
      }
    }
  }
  await adapter.deleteProfile(profileId)

  // If the deleted profile was the current one, clear the selection
  const stored = localStorage.getItem('currentProfileId')
  if (stored && parseInt(stored, 10) === profileId) {
    localStorage.removeItem('currentProfileId')
  }
  const selected = localStorage.getItem('selectedProfileIds')
  if (selected) {
    try {
      const ids = JSON.parse(selected) as number[]
      const filtered = ids.filter((id) => id !== profileId)
      if (filtered.length > 0) {
        localStorage.setItem('selectedProfileIds', JSON.stringify(filtered))
      } else {
        localStorage.removeItem('selectedProfileIds')
      }
    } catch {
      /* ignore */
    }
  }

  return ok()
}

export async function profileResetData(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  const stores = [
    'transactions',
    'categories',
    'accounts',
    'budgets',
    'goals',
    'loans',
    'balanceHistory',
  ]
  for (const store of stores) {
    if (!db.objectStoreNames.contains(store)) continue
    const all = await db.getAll(store)
    for (const item of all) {
      if (pids.includes(item.profile_id as number)) {
        await db.delete(store, item.id as number)
      }
    }
  }
  return ok({ message: 'Profile data reset successfully' })
}
