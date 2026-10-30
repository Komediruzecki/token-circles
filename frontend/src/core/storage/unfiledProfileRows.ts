/**
 * Local-first rows filed on profile 0, and where they go.
 *
 * Until the fix that came with this file, a local workspace with no profile at all wrote on
 * profile 0: `getCurrentProfileId` answered 0 when there was none, every writer used that answer,
 * and every read asked for a real profile. The rows were saved and never shown. A browser got there
 * by choosing "Use local-only" and leaving the setup wizard before its "Name your space" step, or,
 * before the last profile could no longer be deleted (2026-10-09), by deleting every profile.
 *
 * No profile 0 ever exists (the profiles store numbers from 1), so a row on it is one of those. On
 * every open of the database they are filed on a real profile:
 *
 * - **No profile at all**: the workspace's first one is made, under the name the Worker gives an
 *   account's first profile, and becomes the active profile. This is the case the bug left behind:
 *   the person sees what they imported as if it had worked the first time.
 * - **Profiles, all of them empty**: the first of them. Nothing is in it to collide with.
 * - **Profiles, one of them in use**: a profile of their own, named for what they are. The person
 *   may well have imported the same statement again into the profile they made once the first
 *   import showed nothing, and filing the old rows there would count every transaction twice, and
 *   put a second "Groceries" beside the first. A profile of their own doubles nothing, and the
 *   Danger Zone deletes it in one step if it is not wanted.
 *
 * Only rows on profile 0 move: a row of a real profile is never read, let alone written. Every
 * move happens in one transaction that is aborted on any failure, so a load either files all of
 * them or none, and the next load tries again. A second run finds nothing on profile 0 and does
 * nothing.
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

/** The stores that file rows by profile: the ones with a `by_profile` index. */
function profileStores(db: IDBPDatabase): string[] {
  const names = Array.from(db.objectStoreNames)
  if (names.length === 0) return []
  const tx = db.transaction(names)
  return names.filter((name) => tx.objectStore(name).indexNames.contains('by_profile'))
}

const unfiledSettingKeys = () =>
  PROFILE_SETTING_KEYS.map((key) => ({
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

/**
 * File every row on profile 0 on a real profile, as the comment at the top of this file says.
 * Safe to call on every open: with nothing on profile 0 it only counts.
 */
export async function fileUnfiledRows(db: IDBPDatabase): Promise<UnfiledRowsResult> {
  if (!db.objectStoreNames.contains('profiles')) return NOTHING
  const stores = profileStores(db)
  const hasSettings = db.objectStoreNames.contains('settings')

  // The usual answer is "nothing to do", from a read-only look.
  const look = db.transaction([...stores, ...(hasSettings ? ['settings'] : [])])
  let waiting = 0
  for (const name of stores) {
    waiting += await look.objectStore(name).index('by_profile').count(UNFILED_PROFILE_ID)
  }
  if (hasSettings) {
    for (const { from } of unfiledSettingKeys()) {
      if ((await look.objectStore('settings').count(from)) > 0) waiting++
    }
  }
  await look.done
  if (waiting === 0) return NOTHING

  const tx = db.transaction(
    ['profiles', ...stores, ...(hasSettings ? ['settings'] : [])],
    'readwrite'
  )
  try {
    // Counted again inside the write: another tab may have filed them in between.
    const unfiled = new Map<string, IDBValidKey[]>()
    let total = 0
    for (const name of stores) {
      const keys = await tx.objectStore(name).index('by_profile').getAllKeys(UNFILED_PROFILE_ID)
      if (keys.length > 0) unfiled.set(name, keys)
      total += keys.length
    }
    const unfiledSettings: { from: string; to: (id: number) => string; value: unknown }[] = []
    if (hasSettings) {
      for (const { from, to } of unfiledSettingKeys()) {
        const row = (await tx.objectStore('settings').get(from)) as { value: unknown } | undefined
        if (row) unfiledSettings.push({ from, to, value: row.value })
      }
    }
    if (total === 0 && unfiledSettings.length === 0) {
      await tx.done
      return NOTHING
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
      if (!anyInUse) target = Math.min(...profiles.map((p) => p.id))
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
    for (const { from, to, value } of unfiledSettings) {
      const settings = tx.objectStore('settings')
      const destination = to(target)
      // A setting the profile already has is its own; the old one stays where it is.
      if ((await settings.count(destination)) > 0) continue
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
