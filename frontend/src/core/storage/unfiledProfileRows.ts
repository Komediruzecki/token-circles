/**
 * Local-first rows filed on profile 0, and where they go.
 *
 * Until the fix that came with this file, a local workspace with no profile at all wrote on
 * profile 0: `getCurrentProfileId` answered 0 when there was none, every writer used that answer,
 * and every read asked for a real profile. The rows were saved and never shown. A browser got there
 * by choosing "Use local-only" and leaving the setup wizard before its "Name your space" step, and
 * possibly by deleting every profile, before the Danger Zone disabled deleting the last one
 * (2026-07-20).
 *
 * No profile 0 ever exists (the profiles store numbers from 1), so a row on it is one of those. On
 * every open of the database they are filed on a real profile:
 *
 * - **No profile at all**: the workspace's first one is made, under the name the Worker gives an
 *   account's first profile, and becomes the active profile. This is the case the bug left behind:
 *   the person sees what they imported as if it had worked the first time.
 * - **Profiles, none of them holding a row**: the open one (`currentProfileId`), or else the one
 *   with the lowest id. A profile that has its own retirement plan is passed over when a plan on
 *   profile 0 moves too, so the one the person typed in is never replaced.
 * - **Profiles, one of them holding rows** (or every empty one has its own plan): a profile of
 *   their own, named for what they are. The person may well have imported the same statement again
 *   into the profile they made once the first import showed nothing, and filing the old rows there
 *   would count every transaction twice, and put a second "Groceries" beside the first. A profile
 *   of their own doubles nothing, and the Danger Zone deletes it in one step if it is not wanted.
 *
 * Rows decide; the per-profile settings on profile 0 (`retirement_settings:0`, `achievements:0`)
 * follow them to the same profile and never decide anything themselves. With no row on profile 0
 * nothing happens, whatever settings are there. The badge record is worked out from the rows, so
 * where the receiving profile has one already, its own is kept and the one on profile 0 is deleted.
 *
 * Only rows on profile 0 move: a row of a real profile is never written. Every move happens in one
 * transaction that is aborted on any failure, so a load files all of them or none, and the next
 * load tries again. A load that moves them leaves no row on profile 0, so the next one only looks.
 */
import { clashingProfileName } from '../../../../shared/profileSchema'
import { localProfileSettingKey, PROFILE_SETTING_KEYS } from '../../../../shared/profileSettings'
import type { IDBPDatabase } from 'idb'

/** The profile id the old code wrote when there was no profile. No real profile has it. */
export const UNFILED_PROFILE_ID = 0

/** What the Worker names the profile it makes for an account that has none (worker/src/profile.ts). */
export const DEFAULT_PROFILE_NAME = 'Personal Profile'

/** The profile rows get when the workspace already holds another profile's data. */
export const RECOVERED_PROFILE_NAME = 'Recovered entries'

export interface UnfiledRowsResult {
  /** Rows moved, across every store (per-profile settings included). */
  moved: number
  /** The profile they went to, or null when there was nothing to move. */
  profileId: number | null
  /** Whether that profile was made for them. */
  created: boolean
}

const NOTHING: UnfiledRowsResult = { moved: 0, profileId: null, created: false }

/** The profile settings worked out from the rows, which a profile's own copy may replace. */
const DERIVED_SETTINGS: readonly string[] = ['achievements']

const unfiledSettingKeys = () =>
  PROFILE_SETTING_KEYS.map((key) => ({
    key,
    from: localProfileSettingKey(key, UNFILED_PROFILE_ID),
    to: (profileId: number) => localProfileSettingKey(key, profileId),
  }))

/** A name no profile has yet: `name`, or `name 2`, `name 3`, ... */
function freeName(name: string, profiles: { id: unknown; name: unknown }[]): string {
  let candidate = name
  let n = 1
  while (clashingProfileName(profiles, candidate) !== null) {
    n++
    candidate = `${name} ${n}`
  }
  return candidate
}

/** The profile open in this browser, as `currentProfileId` names it, or null. */
function openProfileId(): number | null {
  try {
    const id = Number.parseInt(localStorage.getItem('currentProfileId') ?? '', 10)
    return Number.isInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

/**
 * File every row on profile 0 on a real profile, as the comment at the top of this file says.
 * Safe to call on every open: with no row on profile 0 it is one read-only transaction.
 */
export async function fileUnfiledRows(db: IDBPDatabase): Promise<UnfiledRowsResult> {
  if (!db.objectStoreNames.contains('profiles')) return NOTHING
  const names = Array.from(db.objectStoreNames)

  // The usual answer is "nothing to do", from one read-only look. Only rows count.
  const look = db.transaction(names)
  const stores = names.filter((name) => look.objectStore(name).indexNames.contains('by_profile'))
  let waiting = 0
  for (const name of stores) {
    waiting += await look.objectStore(name).index('by_profile').count(UNFILED_PROFILE_ID)
  }
  await look.done
  if (waiting === 0) return NOTHING

  const hasSettings = db.objectStoreNames.contains('settings')
  const tx = db.transaction(
    ['profiles', ...stores, ...(hasSettings ? ['settings'] : [])],
    'readwrite'
  )
  try {
    // Counted again inside the write: another tab may have filed them since the look, and then
    // this one has nothing to do and must not make a profile.
    const unfiled = new Map<string, IDBValidKey[]>()
    let total = 0
    for (const name of stores) {
      const keys = await tx.objectStore(name).index('by_profile').getAllKeys(UNFILED_PROFILE_ID)
      if (keys.length > 0) unfiled.set(name, keys)
      total += keys.length
    }
    if (total === 0) {
      await tx.done
      return NOTHING
    }
    const unfiledSettings: {
      key: string
      from: string
      to: (id: number) => string
      value: unknown
    }[] = []
    if (hasSettings) {
      for (const { key, from, to } of unfiledSettingKeys()) {
        const row = (await tx.objectStore('settings').get(from)) as { value: unknown } | undefined
        if (row) unfiledSettings.push({ key, from, to, value: row.value })
      }
    }

    const profiles = (await tx.objectStore('profiles').getAll()) as { id: number; name: string }[]
    let target: number | null = null
    if (profiles.length > 0) {
      let anyInUse = false
      for (const profile of profiles) {
        for (const name of stores) {
          if ((await tx.objectStore(name).index('by_profile').count(profile.id)) > 0) {
            anyInUse = true
            break
          }
        }
        if (anyInUse) break
      }
      if (!anyInUse) {
        // A setting the person typed in must not meet a copy of its own on the receiving profile.
        const candidates: number[] = []
        for (const profile of profiles) {
          let collides = false
          for (const { key, to } of unfiledSettings) {
            if (DERIVED_SETTINGS.includes(key) || !hasSettings) continue
            if ((await tx.objectStore('settings').count(to(profile.id))) > 0) collides = true
          }
          if (!collides) candidates.push(profile.id)
        }
        const open = openProfileId()
        if (open !== null && candidates.includes(open)) target = open
        else if (candidates.length > 0) target = Math.min(...candidates)
      }
    }
    let created = false
    if (target === null) {
      const name =
        profiles.length === 0 ? DEFAULT_PROFILE_NAME : freeName(RECOVERED_PROFILE_NAME, profiles)
      target = (await tx
        .objectStore('profiles')
        .add({ name, created_at: new Date().toISOString() })) as number
      created = true
    }

    let moved = 0
    for (const [name, keys] of unfiled) {
      const store = tx.objectStore(name)
      for (const key of keys) {
        const row = (await store.get(key)) as { profile_id?: unknown } | undefined
        // Read again by key: only a row still on profile 0 is touched.
        if (!row || row.profile_id !== UNFILED_PROFILE_ID) continue
        await store.put({ ...row, profile_id: target })
        moved++
      }
    }
    for (const { key, from, to, value } of unfiledSettings) {
      const settings = tx.objectStore('settings')
      const destination = to(target)
      if ((await settings.count(destination)) > 0) {
        // The target was chosen so a typed-in setting never lands here; a badge record is worked
        // out again from the rows, so the profile's own stands and the old one goes.
        if (DERIVED_SETTINGS.includes(key)) await settings.delete(from)
        continue
      }
      await settings.put({ key: destination, value })
      await settings.delete(from)
      moved++
    }
    await tx.done

    // The workspace had no profile: the one made for it is the one in use, for reads and writes.
    if (profiles.length === 0) {
      try {
        localStorage.setItem('currentProfileId', String(target))
        localStorage.removeItem('selectedProfileIds')
      } catch {
        // getCurrentProfileId falls back to the first profile, which is this one.
      }
    }
    return { moved, profileId: target, created }
  } catch (error) {
    try {
      tx.abort()
    } catch {
      // A failed request has already aborted it.
    }
    await tx.done.catch(() => undefined)
    throw error
  }
}
