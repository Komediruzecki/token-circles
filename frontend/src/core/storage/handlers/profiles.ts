/**
 * Profiles handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, notFound, ok, targetProfileIdsFromHeaders } from './helpers'

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

  await adapter.clearProfileData([profileId], { deleteProfiles: true })

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

export async function profileResetData(headers?: HeadersInit): Promise<Response> {
  // Reset the profile(s) named in the request header (Danger Zone can target a
  // non-active profile); fall back to the active profile when none is given.
  const pids = targetProfileIdsFromHeaders(headers) ?? adapter.getCurrentProfileIds()
  await adapter.clearProfileData(pids)
  return ok({ message: 'Profile data reset successfully' })
}
