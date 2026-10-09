/**
 * Profiles handlers — IndexedDB-backed implementations.
 *
 * The rules and their words are shared/profileSchema.ts, which the Worker and the profile dialog
 * run too: a refused name answers 400 { error, fields }, and a person's profiles have different
 * names, compared without case. A rename is checked against the stored name.
 */
import {
  checkProfileCreate,
  checkProfileRename,
  clashingProfileName,
  profileNameTaken,
  renamesProfile,
} from '../../../../../shared/profileSchema'
import { getDB } from '../idb'
import {
  adapter,
  idParam,
  json,
  notFound,
  ok,
  refuse,
  targetProfileIdsFromHeaders,
} from './helpers'

interface ProfileRow {
  id: number
  name: string
  created_at?: string
}

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
  const checked = checkProfileCreate(body)
  if (!checked.ok) return refuse(checked.fields)
  const { name } = checked.value
  const db = await getDB()
  const taken = clashingProfileName((await db.getAll('profiles')) as ProfileRow[], name)
  if (taken !== null) return refuse(profileNameTaken(taken))
  const id = await adapter.createProfile(name)
  const created = (await db.get('profiles', id)) as ProfileRow | undefined
  // The new profile as the list shows it, as the Worker answers it.
  return json(
    {
      id,
      name,
      created_at: created?.created_at ?? new Date().toISOString(),
      transaction_count: 0,
      account_count: 0,
      budget_count: 0,
    },
    201
  )
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
  const id = idParam(params)
  const db = await getDB()
  const profiles = (await db.getAll('profiles')) as ProfileRow[]
  const stored = profiles.find((p) => p.id === id)
  if (!stored) return notFound('Profile')
  const checked = checkProfileRename(body, stored)
  if (!checked.ok) return refuse(checked.fields)
  const { name } = checked.value
  const taken = clashingProfileName(profiles, name, id, !renamesProfile(stored.name, name))
  if (taken !== null) return refuse(profileNameTaken(taken))
  await adapter.updateProfile(id, name)
  // The renamed profile, as the Worker answers it; created_at as the list backfills it.
  return json({ id, name, created_at: stored.created_at || new Date().toISOString() })
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
