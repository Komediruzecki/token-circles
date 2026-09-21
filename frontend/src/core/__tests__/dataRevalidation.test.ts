/**
 * Resume revalidation (audit finding F-03).
 *
 * The app had none: a tab left open overnight showed yesterday's numbers, and an edit made on
 * another device or by the scheduled importer never arrived. On a native shell, which is
 * backgrounded and resumed constantly rather than left open and focused, that is the difference
 * between a working app and one that shows stale data on every resume.
 *
 * The behaviour worth pinning is not "it bumps counters" but the two ways this goes wrong:
 * revalidating on a quick alt-tab (a request storm for nothing), and revalidating on the focus
 * event browsers fire at load (refetching data that was just fetched).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AWAY_THRESHOLD_MS, initDataRevalidation } from '../dataRevalidation'
import { __resetDataVersionsForTest, entityVersion, invalidateEntity } from '../dataVersions'

/** A manually fired event source, standing in for visibilitychange / focus / online. */
function makeSource() {
  const listeners = new Set<() => void>()
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    fire: () => {
      listeners.forEach((fn) => {
        fn()
      })
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

/** A clock the test moves by hand, so no test waits on a real minute. */
function makeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

/**
 * Create the counters a real session would have. A slot exists only because a consumer asked for
 * it, so with no consumers there is nothing to revalidate and every test here would pass vacuously.
 */
function withTrackedEntities(...tags: string[]) {
  for (const tag of tags) entityVersion(tag)
}

beforeEach(() => {
  __resetDataVersionsForTest()
})

describe('resume revalidation', () => {
  it('revalidates after the app was away longer than the window', () => {
    withTrackedEntities('categories', 'transactions')
    const before = { c: entityVersion('categories'), t: entityVersion('transactions') }
    const suspend = makeSource()
    const resume = makeSource()
    const clock = makeClock()

    initDataRevalidation({
      suspendSources: [suspend.subscribe],
      resumeSources: [resume.subscribe],
      reconnectSources: [],
      now: clock.now,
    })

    suspend.fire()
    clock.advance(AWAY_THRESHOLD_MS + 1)
    resume.fire()

    // Every tracked entity moves: on resume the client cannot know which of them another device,
    // another tab or the importer changed.
    expect(entityVersion('categories')).toBe(before.c + 1)
    expect(entityVersion('transactions')).toBe(before.t + 1)
  })

  it('does not revalidate on a brief alt-tab', () => {
    withTrackedEntities('categories')
    const before = entityVersion('categories')
    const suspend = makeSource()
    const resume = makeSource()
    const clock = makeClock()

    initDataRevalidation({
      suspendSources: [suspend.subscribe],
      resumeSources: [resume.subscribe],
      reconnectSources: [],
      now: clock.now,
    })

    suspend.fire()
    clock.advance(AWAY_THRESHOLD_MS - 1)
    resume.fire()

    expect(entityVersion('categories')).toBe(before)
  })

  it('ignores a resume that was never preceded by a suspend', () => {
    // Browsers fire `focus` once shortly after load. Treating that as a resume would refetch
    // everything the app had just finished fetching.
    withTrackedEntities('categories')
    const before = entityVersion('categories')
    const resume = makeSource()
    const clock = makeClock()

    initDataRevalidation({
      suspendSources: [],
      resumeSources: [resume.subscribe],
      reconnectSources: [],
      now: clock.now,
    })

    clock.advance(AWAY_THRESHOLD_MS * 10)
    resume.fire()

    expect(entityVersion('categories')).toBe(before)
  })

  it('revalidates once per away period, not once per resume event', () => {
    // visibilitychange and focus both fire on a single return to the tab. Two listeners must not
    // mean two rounds of refetching.
    withTrackedEntities('categories')
    const before = entityVersion('categories')
    const suspend = makeSource()
    const visibility = makeSource()
    const focus = makeSource()
    const clock = makeClock()

    initDataRevalidation({
      suspendSources: [suspend.subscribe],
      resumeSources: [visibility.subscribe, focus.subscribe],
      reconnectSources: [],
      now: clock.now,
    })

    suspend.fire()
    clock.advance(AWAY_THRESHOLD_MS + 1)
    visibility.fire()
    focus.fire()

    expect(entityVersion('categories')).toBe(before + 1)
  })

  it('treats a reconnect as a revalidation regardless of the away window', () => {
    // Losing the network fires no suspend, so there is no away period to measure — and the
    // duration is the wrong question anyway, since nothing that changed while offline was seen.
    withTrackedEntities('categories')
    const before = entityVersion('categories')
    const reconnect = makeSource()
    const clock = makeClock()

    initDataRevalidation({
      suspendSources: [],
      resumeSources: [],
      reconnectSources: [reconnect.subscribe],
      now: clock.now,
    })

    reconnect.fire()

    expect(entityVersion('categories')).toBe(before + 1)
  })

  it('only bumps entities something is actually tracking', () => {
    // Bumping every name in the EntityTag union would refetch pages nobody has opened.
    withTrackedEntities('categories')
    const suspend = makeSource()
    const resume = makeSource()
    const clock = makeClock()

    initDataRevalidation({
      suspendSources: [suspend.subscribe],
      resumeSources: [resume.subscribe],
      reconnectSources: [],
      now: clock.now,
    })

    suspend.fire()
    clock.advance(AWAY_THRESHOLD_MS + 1)
    resume.fire()

    // 'portfolio' was never read, so it has no slot; reading it now starts it at zero rather than
    // showing it had been bumped in the background.
    expect(entityVersion('portfolio')).toBe(0)
  })

  it('removes every listener when disposed', () => {
    const suspend = makeSource()
    const resume = makeSource()
    const reconnect = makeSource()

    const dispose = initDataRevalidation({
      suspendSources: [suspend.subscribe],
      resumeSources: [resume.subscribe],
      reconnectSources: [reconnect.subscribe],
    })
    expect(suspend.listenerCount).toBe(1)
    expect(resume.listenerCount).toBe(1)
    expect(reconnect.listenerCount).toBe(1)

    dispose()

    expect(suspend.listenerCount).toBe(0)
    expect(resume.listenerCount).toBe(0)
    expect(reconnect.listenerCount).toBe(0)
  })

  it('does not disturb counters a write already moved', () => {
    // Resume revalidation rides the same counters as writes. A bump from a write must survive it.
    withTrackedEntities('categories')
    invalidateEntity('categories')
    const afterWrite = entityVersion('categories')
    const suspend = makeSource()
    const resume = makeSource()
    const clock = makeClock()

    initDataRevalidation({
      suspendSources: [suspend.subscribe],
      resumeSources: [resume.subscribe],
      reconnectSources: [],
      now: clock.now,
    })

    suspend.fire()
    clock.advance(AWAY_THRESHOLD_MS + 1)
    resume.fire()

    expect(entityVersion('categories')).toBe(afterWrite + 1)
  })
})

describe('browser wiring', () => {
  it('defaults to real browser events and tears them down', () => {
    // The default sources are the ones that actually ship, so a typo in an event name would
    // otherwise only show up in the live app.
    const addDoc = vi.spyOn(document, 'addEventListener')
    const addWin = vi.spyOn(window, 'addEventListener')
    const removeDoc = vi.spyOn(document, 'removeEventListener')
    const removeWin = vi.spyOn(window, 'removeEventListener')

    const dispose = initDataRevalidation()

    const docEvents = addDoc.mock.calls.map((c) => c[0])
    const winEvents = addWin.mock.calls.map((c) => c[0])
    expect(docEvents.filter((e) => e === 'visibilitychange')).toHaveLength(2) // resume + suspend
    expect(winEvents).toContain('focus')
    expect(winEvents).toContain('blur')
    expect(winEvents).toContain('online')

    dispose()

    expect(removeDoc.mock.calls.map((c) => c[0])).toContain('visibilitychange')
    const removedWin = removeWin.mock.calls.map((c) => c[0])
    expect(removedWin).toContain('focus')
    expect(removedWin).toContain('blur')
    expect(removedWin).toContain('online')

    vi.restoreAllMocks()
  })
})
