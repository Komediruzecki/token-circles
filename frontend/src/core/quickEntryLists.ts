/**
 * quickEntryLists — what the quick entries (the Ctrl/Cmd+K command bar and the Guided Orbit behind
 * the floating + button) offer an entry: the ACTIVE profile's categories and accounts, current
 * when shown.
 *
 * WHY THIS EXISTS. App used to keep one copy of the categories for both quick entries. It read it
 * on every profile switch and again on each open, fired the read and stored whatever came back.
 * Reported on dev, 2026-10-07, with the local-first demo on a phone:
 *
 * - The read covered the household (`selectedProfileIds`) while an entry is written to the active
 *   profile (`currentProfileId`). With two profiles ticked it offered categories, and accounts,
 *   that the save then refused: "Failed to save entry".
 * - A failed read kept the previous list, whoever's it was. In local-first a category made on
 *   Budgets failed the typed client's validation, so the orb said there were no categories straight
 *   after one was made, and after a switch it went on offering the last profile's.
 * - It loaded after the quick entry had opened and showed the old list meanwhile, and nothing
 *   stopped an older answer from landing after a newer one.
 *
 * Each list here belongs to one profile and says which (`profileId`), offers only that profile's
 * rows, and says when it is still loading or could not load, so nobody is told "no categories" for
 * a list that has not arrived. It follows the invalidation seam (core/dataVersions.ts) the way a
 * page does, with "a quick entry is open" standing in for "the page is visible": a change while
 * open reloads now, a change while closed waits for the next open (core/pageVisibility.ts explains
 * why hidden consumers defer). The newest read wins.
 */
import { createEffect, createSignal, on, untrack } from 'solid-js'
import { activeProfileId } from './apiProfileScope'
import type { Accessor } from 'solid-js'

export type QuickEntryListStatus = 'loading' | 'ready' | 'error'

/**
 * The rows of one profile. A household read answers for every ticked profile, and local-first
 * answers for the household whatever it is asked, but an entry is written to one profile and its
 * save refuses a category or an account of any other. The quick entries and the Transactions form
 * both offer only what this returns.
 */
export function rowsOfProfile<T extends { profile_id: number }>(
  rows: readonly T[] | null | undefined,
  profileId: number | null
): T[] {
  if (profileId === null || !Array.isArray(rows)) return []
  return rows.filter((row) => row.profile_id === profileId)
}

export interface QuickEntryList<T> {
  /** The rows to offer: the active profile's, once its answer is in. Empty while loading. */
  items: Accessor<T[]>
  status: Accessor<QuickEntryListStatus>
  /** The profile `items` belong to (or are being loaded for). Null before anything was asked. */
  profileId: Accessor<number | null>
  /**
   * Are these the active profile's rows, loaded? Checked against `currentProfileId` as it is now,
   * which is what a save's `X-Profile-Id` will say, so a switch made in another tab counts too.
   */
  isCurrent: () => boolean
  /** Read again now: the retry after a failed read, or after a save found the list out of date. */
  reload: () => void
}

interface Held<T> {
  profileId: number | null
  items: T[]
  status: QuickEntryListStatus
}

export interface QuickEntryListOptions<T> {
  /** Is a quick entry open? Reads happen while one is; changes made meanwhile wait for the next. */
  isOpen: Accessor<boolean>
  /** False while reads are not allowed yet (cloud mode before sign-in). Going false forgets. */
  enabled: Accessor<boolean>
  /** The reactive inputs: the profile version and the entity's own counter. */
  track: () => unknown
  /** The read. Whatever profiles it covers, only the active profile's rows are kept. */
  read: () => Promise<T[]>
}

const EMPTY: Held<never> = { profileId: null, items: [], status: 'loading' }

export function createQuickEntryList<T extends { profile_id: number }>(
  options: QuickEntryListOptions<T>
): QuickEntryList<T> {
  const [held, setHeld] = createSignal<Held<T>>(EMPTY)
  /** Bumped by every read, so an answer can tell whether a newer read was sent after it. */
  let asked = 0
  /** Something changed since the last read: the next open reads again. */
  let stale = true

  /**
   * @param keepShown A read made while the quick entry is open on this same profile: the rows on
   *   screen stay until the answer replaces them, so a refresh under the person's eyes does not
   *   blank the list. Any other read starts from "loading": the old rows are out of date, or
   *   belong to another profile.
   */
  const load = (keepShown: boolean) => {
    if (!untrack(options.enabled)) return
    stale = false
    const ask = ++asked
    const pid = activeProfileId()
    const shown = untrack(held)
    const keep = keepShown && shown.status === 'ready' && shown.profileId === pid
    if (!keep) setHeld({ profileId: pid, items: [], status: 'loading' })

    options.read().then(
      (rows) => {
        if (ask !== asked) return
        if (pid !== activeProfileId()) {
          // The active profile moved without this tab bumping anything (another tab did it). The
          // answer is for a profile nobody files to any more.
          stale = true
          if (untrack(options.isOpen)) load(false)
          return
        }
        setHeld({ profileId: pid, items: rowsOfProfile(rows, pid), status: 'ready' })
      },
      () => {
        if (ask !== asked) return
        // Try again on the next open, whatever is shown now.
        stale = true
        // A failed refresh of this profile's own list keeps what is on screen; anything else says
        // it failed rather than offering rows nobody can file under.
        if (keep) return
        setHeld({ profileId: pid, items: [], status: 'error' })
      }
    )
  }

  createEffect(
    on(
      () => [options.enabled(), options.track()],
      () => {
        if (!untrack(options.enabled)) {
          // Signed out: drop the rows and any answer still on its way.
          asked++
          stale = true
          setHeld(EMPTY)
          return
        }
        if (untrack(options.isOpen)) load(true)
        else stale = true
      }
    )
  )

  createEffect(
    on(options.isOpen, (open) => {
      if (!open) return
      // Read again if anything changed while closed, or if the active profile is not the one the
      // rows are for: a switch made in another tab moves currentProfileId and bumps nothing here.
      if (stale || untrack(held).profileId !== activeProfileId()) load(false)
    })
  )

  const isCurrent = () => {
    const h = held()
    return h.status === 'ready' && h.profileId === activeProfileId()
  }

  return {
    items: () => held().items,
    status: () => held().status,
    profileId: () => held().profileId,
    isCurrent,
    reload: () => {
      load(false)
    },
  }
}
