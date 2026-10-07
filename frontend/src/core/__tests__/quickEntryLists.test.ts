/**
 * createQuickEntryList: the list a quick entry offers belongs to the active profile, follows its
 * inputs while open, waits for the next open while closed, and never shows an answer that is not
 * the newest or not for the profile an entry would be filed under.
 *
 * The App-level behaviour, with the real orb and command bar in both storage modes, is in
 * src/__tests__/quickEntryOffersActiveProfile.test.tsx. These pin the loader's own rules.
 */
import { createRoot, createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createQuickEntryList, quickEntrySave } from '../quickEntryLists'
import type { QuickEntryList } from '../quickEntryLists'

interface Row {
  id: number
  name: string
  profile_id: number
}

const rows: Row[] = [
  { id: 1, name: 'Groceries', profile_id: 1 },
  { id: 2, name: 'Eating out', profile_id: 2 },
  { id: 3, name: 'Fuel', profile_id: 2 },
]

/** A read the test answers by hand, in any order. */
interface Pending {
  forProfile: number
  answer: (list?: Row[]) => void
  fail: () => void
}

const flush = () => new Promise((r) => setTimeout(r, 0))

let pending: Pending[]
let dispose: () => void
let list: QuickEntryList<Row>
let setOpen: (v: boolean) => void
let setEnabled: (v: boolean) => void
let bump: () => void

function mount() {
  createRoot((d) => {
    dispose = d
    const [open, so] = createSignal(false)
    const [enabled, se] = createSignal(true)
    const [version, setVersion] = createSignal(0)
    setOpen = so
    setEnabled = se
    bump = () => setVersion((v) => v + 1)
    list = createQuickEntryList<Row>({
      isOpen: open,
      enabled,
      track: () => version(),
      read: () =>
        new Promise<Row[]>((resolve, reject) => {
          const forProfile = Number(localStorage.getItem('currentProfileId'))
          pending.push({
            forProfile,
            // The answer covers the household (both profiles), the way a household read does.
            answer: (answerRows = rows) => {
              resolve(answerRows)
            },
            fail: () => {
              reject(new Error('dropped'))
            },
          })
        }),
    })
  })
}

const names = () => list.items().map((r) => r.name)

/** What a profile switch in the sidebar does: move currentProfileId, then bump. */
function switchTo(id: number) {
  localStorage.setItem('currentProfileId', String(id))
  bump()
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  pending = []
  mount()
})

afterEach(() => {
  dispose()
})

describe('createQuickEntryList', () => {
  it('reads nothing until a quick entry opens', () => {
    switchTo(2)
    bump()
    expect(pending).toHaveLength(0)
  })

  it('offers only the active profile’s rows from a household answer', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()

    expect(names()).toEqual(['Groceries'])
    expect(list.profileId()).toBe(1)
    expect(list.isCurrent()).toBe(true)
  })

  it('is loading, with nothing to offer, until the answer is in', async () => {
    setOpen(true)
    expect(list.status()).toBe('loading')
    expect(names()).toEqual([])

    pending[0].answer()
    await flush()
    expect(list.status()).toBe('ready')
  })

  it('after a switch while closed, reads on the next open and never shows the old rows', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()
    setOpen(false)

    switchTo(2)
    expect(pending).toHaveLength(1)
    setOpen(true)

    expect(pending).toHaveLength(2)
    expect(names()).toEqual([])
    expect(list.status()).toBe('loading')
    pending[1].answer()
    await flush()
    expect(names()).toEqual(['Eating out', 'Fuel'])
  })

  it('after a switch while open, reads at once and shows nothing of the old profile meanwhile', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()

    switchTo(2)

    expect(pending).toHaveLength(2)
    expect(names()).toEqual([])
    pending[1].answer()
    await flush()
    expect(names()).toEqual(['Eating out', 'Fuel'])
  })

  it('a write made elsewhere while closed is read on the next open, once', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()
    setOpen(false)

    bump()
    bump()
    expect(pending).toHaveLength(1)
    setOpen(true)
    expect(pending).toHaveLength(2)
  })

  it('opening again with nothing changed reads nothing', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()
    setOpen(false)
    setOpen(true)

    expect(pending).toHaveLength(1)
    expect(names()).toEqual(['Groceries'])
  })

  it('a write made elsewhere while open keeps the rows on screen until the new answer', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()

    bump()

    expect(pending).toHaveLength(2)
    expect(names()).toEqual(['Groceries'])
    expect(list.status()).toBe('ready')
    pending[1].answer([...rows, { id: 4, name: 'Pharmacy', profile_id: 1 }])
    await flush()
    expect(names()).toEqual(['Groceries', 'Pharmacy'])
  })

  it('keeps the newest answer when an older one arrives after it', async () => {
    setOpen(true)
    switchTo(2)
    switchTo(1)
    expect(pending.map((p) => p.forProfile)).toEqual([1, 2, 1])

    pending[2].answer()
    await flush()
    pending[1].answer()
    pending[0].answer([])
    await flush()

    expect(names()).toEqual(['Groceries'])
    expect(list.profileId()).toBe(1)
  })

  it('a failed read says so and offers nothing, rather than another profile’s rows', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()

    switchTo(2)
    pending[1].fail()
    await flush()

    expect(list.status()).toBe('error')
    expect(names()).toEqual([])

    list.reload()
    expect(list.status()).toBe('loading')
    pending[2].answer()
    await flush()
    expect(names()).toEqual(['Eating out', 'Fuel'])
  })

  it('a failed refresh of the open profile’s own rows keeps them, and reads again on the next open', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()

    bump()
    pending[1].fail()
    await flush()
    expect(names()).toEqual(['Groceries'])
    expect(list.status()).toBe('ready')

    setOpen(false)
    setOpen(true)
    expect(pending).toHaveLength(3)
  })

  it('is not current once another tab moves the active profile, and reads again on open', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()
    setOpen(false)

    // Another tab: currentProfileId moves, nothing in this tab bumps.
    localStorage.setItem('currentProfileId', '2')

    expect(list.isCurrent()).toBe(false)
    setOpen(true)
    expect(pending).toHaveLength(2)
    expect(pending[1].forProfile).toBe(2)
  })

  it('an answer for a profile that is no longer active is dropped and read again', async () => {
    setOpen(true)
    localStorage.setItem('currentProfileId', '2')
    pending[0].answer()
    await flush()

    expect(names()).toEqual([])
    expect(pending).toHaveLength(2)
    pending[1].answer()
    await flush()
    expect(names()).toEqual(['Eating out', 'Fuel'])
  })

  it('forgets everything, and drops answers on their way, when reads stop being allowed', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()
    bump()

    setEnabled(false)
    pending[1].answer()
    await flush()

    expect(names()).toEqual([])
    expect(list.profileId()).toBeNull()
    list.reload()
    expect(pending).toHaveLength(2)
  })

  it('reads nothing for a save that closes the entry, and once on the next open', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()

    await quickEntrySave(async () => {
      // The write's own bump, App's profile-version bump, then the entry closes.
      bump()
      bump()
      setOpen(false)
    })
    expect(pending).toHaveLength(1)

    setOpen(true)
    expect(pending).toHaveLength(2)
  })

  it('reads once when a save that keeps the entry open is over, keeping its rows meanwhile', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()

    await quickEntrySave(async () => {
      bump()
      bump()
      expect(pending).toHaveLength(1)
    })

    expect(pending).toHaveLength(2)
    expect(names()).toEqual(['Groceries'])
    expect(list.status()).toBe('ready')
  })

  it('reads nothing after a save that changed nothing', async () => {
    setOpen(true)
    pending[0].answer()
    await flush()

    await expect(
      quickEntrySave(async () => {
        throw new Error('Failed to save entry')
      })
    ).rejects.toThrow('Failed to save entry')

    expect(pending).toHaveLength(1)
  })
})
