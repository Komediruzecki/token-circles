/**
 * You must always be able to read the profile you are writing to.
 *
 * THE BUG THIS PINS. Two independent localStorage keys decide two different things:
 *
 *   currentProfileId   -> X-Profile-Id   -> which profile a WRITE lands in
 *   selectedProfileIds -> X-Profile-Ids  -> which profiles a READ returns
 *
 * Nothing kept them consistent. `Settings > Household profiles` let you uncheck the profile you
 * were actively using — it guarded only against the list becoming *empty* — and
 * `householdProfileIds()` returned that set verbatim. From then on every category, account and
 * transaction you created was filed under a profile that no read asked for.
 *
 * The user-visible shape was brutal precisely because it did not look like a caching bug:
 *   - "Category added" toast, then the category is in neither the Categories list nor the
 *     transaction modal;
 *   - a full browser reload does not help, because both values are in localStorage;
 *   - re-adding the same name fails with "already exists", because the row really is there;
 *   - switching profile and back makes everything appear at once, because selectProfile()
 *     rewrites BOTH keys and the two sets realign.
 *
 * The invariant below is enforced at the seam rather than at each of the ~10 writers of these
 * keys, so a future writer that forgets cannot resurrect the bug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiHouseholdGet, apiPost } from '../api'
import { apiFetch } from '../apiFetch'
import { activeProfileId, householdProfileIds, profileRequestHeaders } from '../apiProfileScope'

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

/** A stand-in for localStorage holding an exact state. */
const storageOf = (entries: Record<string, string>) => ({
  getItem: (key: string) => entries[key] ?? null,
})

describe('the active profile is always readable', () => {
  it('includes the active profile even when the household selection omits it', () => {
    // Exactly the state left behind by unchecking your own profile in Settings > Household.
    const storage = storageOf({ currentProfileId: '1', selectedProfileIds: '[2,3]' })

    expect(householdProfileIds(storage)).toContain(1)
  })

  it('puts the write profile inside the read set in the actual request headers', () => {
    // The two headers are produced together, so this is the end of the chain: a write announced
    // by X-Profile-Id must be covered by the X-Profile-Ids of the reads that follow it.
    const storage = storageOf({ currentProfileId: '1', selectedProfileIds: '[2,3]' })

    const headers = profileRequestHeaders('household', storage)
    const writesTo = Number(headers['X-Profile-Id'])
    const readsFrom = JSON.parse(headers['X-Profile-Ids']) as number[]

    expect(readsFrom).toContain(writesTo)
  })

  it('keeps the profiles the user did choose', () => {
    // The fix must not collapse the household view down to the active profile — a household of
    // several people reading each other's data is the whole point of the feature.
    const storage = storageOf({ currentProfileId: '1', selectedProfileIds: '[2,3]' })

    const ids = householdProfileIds(storage)
    expect(ids).toEqual(expect.arrayContaining([1, 2, 3]))
    expect(ids).toHaveLength(3)
  })

  it('does not duplicate the active profile when it is already selected', () => {
    const storage = storageOf({ currentProfileId: '2', selectedProfileIds: '[2,3]' })

    expect(householdProfileIds(storage)).toEqual([2, 3])
  })

  it('still falls back to the active profile when nothing is stored', () => {
    expect(householdProfileIds(storageOf({ currentProfileId: '4' }))).toEqual([4])
  })

  it('still falls back when the stored value is corrupt', () => {
    const storage = storageOf({ currentProfileId: '4', selectedProfileIds: 'not json' })
    expect(householdProfileIds(storage)).toEqual([4])
  })

  it('drops junk entries but keeps the active profile', () => {
    const storage = storageOf({ currentProfileId: '1', selectedProfileIds: '[0,-3,"x",2]' })
    const ids = householdProfileIds(storage)
    expect(ids).toContain(1)
    expect(ids).toContain(2)
    expect(ids).not.toContain(0)
    expect(ids).not.toContain(-3)
  })

  it('holds for every scope that carries a household header', () => {
    // 'active' scope sends no X-Profile-Ids at all, so there is nothing to diverge from; the
    // invariant only has to hold where both headers travel together.
    const storage = storageOf({ currentProfileId: '1', selectedProfileIds: '[2]' })

    expect(profileRequestHeaders('active', storage)['X-Profile-Ids']).toBeUndefined()
    expect(profileRequestHeaders('none', storage)).toEqual({})
    expect(activeProfileId(storage)).toBe(1)
  })
})

describe('the reported sequence, end to end', () => {
  /**
   * Replays what the user did, at the level where the bug actually lives: the headers. A category
   * created under these headers lands in `writesTo`; the Categories page and the transaction
   * modal both read at household scope, so they see `readsFrom`. If the first is not in the
   * second, the row is invisible everywhere while still occupying its unique name.
   */
  const scopeOf = (entries: Record<string, string>) => {
    const headers = profileRequestHeaders('household', storageOf(entries))
    return {
      writesTo: Number(headers['X-Profile-Id']),
      readsFrom: JSON.parse(headers['X-Profile-Ids']) as number[],
    }
  }

  beforeEach(() => {
    localStorage.clear()
  })

  it('a category created after unchecking your own profile is still visible', () => {
    const { writesTo, readsFrom } = scopeOf({
      currentProfileId: '1',
      selectedProfileIds: '[2,3]',
    })

    // Before the fix: writesTo=1, readsFrom=[2,3]. The "extras" category the user created went
    // to profile 1 and no read ever asked for profile 1 again.
    expect(readsFrom).toContain(writesTo)
  })

  it('survives a reload, because the divergence was persisted rather than in memory', () => {
    // Both keys live in localStorage, which is why Ctrl+R did not help and why this has to be
    // fixed at read time rather than by clearing some in-memory signal.
    localStorage.setItem('currentProfileId', '1')
    localStorage.setItem('selectedProfileIds', '[2,3]')

    expect(householdProfileIds()).toContain(activeProfileId())
  })
})

/**
 * The same guarantee through the real request functions.
 *
 * The checks above call `profileRequestHeaders` directly. These drive `apiPost` and
 * `apiHouseholdGet` — the exact pair the Categories page uses to create a category and to list
 * them — so the wiring between the two is what is under test, not a restatement of it.
 *
 * This matters here specifically: `core/__tests__/profileSelection.test.ts` covers this area
 * heavily but tests *reimplemented copies* of the selection helpers rather than importing the
 * real ones, so it could not have caught a mismatch between a writer and a reader.
 */
describe('a created category is readable by the list that follows it', () => {
  const headersOf = (callIndex: number) =>
    new Headers(apiFetchMock.mock.calls[callIndex]?.[1]?.headers)

  beforeEach(() => {
    localStorage.clear()
    apiFetchMock.mockReset()
    // A fresh Response per call: a body can only be read once, so a single shared instance makes
    // the second call fail with "Body is unusable" rather than exercising the headers.
    apiFetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    )
  })

  it('files the category where the next household read will look for it', async () => {
    // The state the user was in: actively on profile 1, household selection no longer lists it.
    localStorage.setItem('currentProfileId', '1')
    localStorage.setItem('selectedProfileIds', '[2,3]')

    await apiPost('/api/categories', { name: 'extras', type: 'expense', color: '#fff' })
    await apiHouseholdGet('/api/categories')

    const wroteTo = Number(headersOf(0).get('X-Profile-Id'))
    const readFrom = JSON.parse(headersOf(1).get('X-Profile-Ids') ?? '[]') as number[]

    expect(wroteTo).toBe(1)
    expect(readFrom).toContain(1)
  })

  it('holds for the ordinary case too, where the selection already lists the active profile', async () => {
    localStorage.setItem('currentProfileId', '2')
    localStorage.setItem('selectedProfileIds', '[2,3]')

    await apiPost('/api/categories', { name: 'rent', type: 'expense', color: '#fff' })
    await apiHouseholdGet('/api/categories')

    expect(JSON.parse(headersOf(1).get('X-Profile-Ids') ?? '[]')).toEqual([2, 3])
  })
})
