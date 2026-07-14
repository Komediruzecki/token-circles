import { createEffect, createRoot, createSignal } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { setPage } from '../appStore'
import { gatedSource, refetchOnActive } from '../pageVisibility'

// Flush Solid's effect scheduler (and any queued microtasks) between steps.
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('pageVisibility - refetchOnActive (imperative loaders)', () => {
  it('refetches the visible page now, defers hidden pages, flushes once on show', async () => {
    await createRoot(async (dispose) => {
      setPage('dashboard') // dashboard is the visible page
      let runs = 0
      const [dep, setDep] = createSignal(0)
      refetchOnActive(
        'dashboard',
        () => {
          void dep()
        },
        () => {
          runs++
        }
      )
      await tick()
      expect(runs).toBe(1) // initial load fires on mount while visible

      setDep(1)
      await tick()
      expect(runs).toBe(2) // dep change while visible → refetch now

      setPage('transactions') // navigate away
      await tick()
      expect(runs).toBe(2) // leaving a fresh page never refetches or marks it stale

      setDep(2) // dep changes while hidden
      await tick()
      expect(runs).toBe(2) // deferred — no background refetch

      setPage('dashboard') // navigate back
      await tick()
      expect(runs).toBe(3) // stale data flushed exactly once on show

      setPage('transactions')
      await tick()
      setPage('dashboard')
      await tick()
      expect(runs).toBe(3) // plain nav-back with no dep change → no refetch (instant nav)

      dispose()
    })
  })

  it('coalesces multiple hidden dep changes into a single on-show refetch', async () => {
    await createRoot(async (dispose) => {
      setPage('goals')
      let runs = 0
      const [dep, setDep] = createSignal(0)
      refetchOnActive(
        'goals',
        () => {
          void dep()
        },
        () => {
          runs++
        }
      )
      await tick()
      expect(runs).toBe(1)

      setPage('loans') // hide goals
      await tick()
      setDep(1)
      setDep(2)
      setDep(3) // three changes while hidden
      await tick()
      expect(runs).toBe(1) // still deferred

      setPage('goals') // show
      await tick()
      expect(runs).toBe(2) // a single refetch, not three

      dispose()
    })
  })
})

describe('pageVisibility - gatedSource (createResource sources)', () => {
  // A change of the returned signal's value models a createResource refetch.
  it('gates a primitive source by visibility', async () => {
    await createRoot(async (dispose) => {
      setPage('accounts')
      const [pv, setPv] = createSignal(0)
      const held = gatedSource('accounts', () => pv())
      let fetches = 0
      createEffect(() => {
        void held()
        fetches++
      })
      await tick()
      expect(fetches).toBe(1) // resource's initial fetch off the seed value

      setPv(1)
      await tick()
      expect(fetches).toBe(2) // visible dep change → refetch now

      setPage('bills') // hide accounts
      await tick()
      setPv(2) // change while hidden
      await tick()
      expect(fetches).toBe(2) // deferred — no background refetch

      setPage('accounts') // show
      await tick()
      expect(fetches).toBe(3) // flushed once with the latest deps

      dispose()
    })
  })

  it('does not refetch an object source on a plain nav-back (identity trap)', async () => {
    await createRoot(async (dispose) => {
      setPage('budgets')
      const [month, setMonth] = createSignal('2026-07')
      // A fresh object every evaluation — a naive gate would refetch on every revisit.
      const held = gatedSource('budgets', () => ({ m: month() }))
      let fetches = 0
      createEffect(() => {
        void held()
        fetches++
      })
      await tick()
      expect(fetches).toBe(1)

      setPage('bills') // hide, no dep change, show again
      await tick()
      setPage('budgets')
      await tick()
      expect(fetches).toBe(1) // no spurious refetch despite new object identity

      setPage('bills') // hide, change month, show
      await tick()
      setMonth('2026-08')
      await tick()
      expect(fetches).toBe(1) // deferred while hidden
      setPage('budgets')
      await tick()
      expect(fetches).toBe(2) // flushed once on show

      dispose()
    })
  })
})
