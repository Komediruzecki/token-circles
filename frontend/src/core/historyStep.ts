/**
 * A history entry for a step that lives only in memory, so the system back gesture can leave it.
 *
 * The sign-in screen's steps after the form (a code by email, the second factor, Check your inbox)
 * and the sign-in dialog are a signal, not a route. In an installed app on Android the back gesture
 * pops a history entry, and with none to pop it closes the app: someone on the code step had to
 * kill the app to get back to the form. So entering a step pushes ONE entry (same URL, same hash,
 * its depth in the state), and popping it runs the step's own way back.
 *
 * - The entry is pushed when `active` turns true and taken back when it turns false by any route
 *   other than the pop, so leaving through the step's own Back neither grows history nor leaves an
 *   entry that swallows the next back gesture.
 * - Moving from one step to another (a code by email to the second factor) keeps `active` true, so
 *   the steps share the one entry.
 * - Steps nest: the dialog has an entry (depth 1) and its own steps one above it (depth 2). A pop
 *   below a step's depth is that step's back; the dialog's step only sees the pop below its own.
 * - The URL never changes, so there is no hashchange: App.tsx's hash routing does not see any of it.
 * - A sign-in reloads the page, and a reload keeps the current entry. `afterHistoryStep` takes every
 *   step entry back first, so the signed-in app does not start ahead of where it loaded, with a
 *   back gesture that only reloads it. Closing the dialog goes through it too.
 */
import { createEffect, on, onCleanup } from 'solid-js'

const MARK = 'tcHistoryStep'

/** Set while `afterHistoryStep` takes the entries back: the steps stay as they are until then. */
let unwinding = false
/** What waits for the entries to be gone: a second call while they go joins the first. */
let waiting: (() => void)[] = []

/** How many step entries the current one sits on top of, counting itself; 0 when it is no step's. */
function depth(state: unknown): number {
  if (typeof state !== 'object' || state === null) return 0
  const mark = (state as Record<string, unknown>)[MARK]
  return typeof mark === 'number' && mark > 0 ? mark : 0
}

export function createHistoryStep(options: {
  /** True while the step is on screen. */
  active: () => boolean
  /** The step's own way back, run when the back gesture pops the entry. */
  back: () => void
  /**
   * The URL for the entry under the step, when it should differ from the one the step is on: the
   * second factor arrives with ?twofa=1, which only the step's own entry should keep.
   */
  below?: () => string | undefined
}): void {
  // The depth of this step's entry, once pushed.
  let mine = 0

  createEffect(
    on(options.active, (active, was) => {
      if (active && !was) {
        const state = history.state as unknown
        mine = depth(state) + 1
        const marked = { ...(state as object), [MARK]: mine }
        const below = options.below?.()
        try {
          if (below !== undefined && below !== window.location.href) {
            const here = window.location.href
            history.replaceState(state, '', below)
            history.pushState(marked, '', here)
          } else {
            history.pushState(marked, '')
          }
        } catch {
          // A history that refuses the entry leaves the step as it was before: Back still works.
          mine = 0
        }
      } else if (!active && was && mine > 0) {
        // Left by the step's own Back. When the gesture left it, the pop already happened and the
        // current entry is below this step's; one at or above it is this step's, to take back.
        const above = depth(history.state) - mine + 1
        mine = 0
        if (above > 0 && !unwinding) history.go(-above)
      }
    })
  )

  const onPop = () => {
    if (unwinding) return
    if (options.active() && mine > 0 && depth(history.state) < mine) {
      mine = 0
      options.back()
    }
  }
  window.addEventListener('popstate', onPop)
  onCleanup(() => {
    window.removeEventListener('popstate', onPop)
  })
}

/**
 * Run `then` once every step entry is gone: at once when there is none, else after history.go()
 * lands (or a second at most, so a history that never answers cannot hold a sign-in up).
 */
export function afterHistoryStep(then: () => void): void {
  const steps = depth(history.state)
  if (steps === 0 && !unwinding) {
    then()
    return
  }
  waiting.push(then)
  if (unwinding) return
  unwinding = true
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    window.removeEventListener('popstate', finish)
    clearTimeout(timer)
    const run = waiting
    waiting = []
    for (const next of run) next()
    // On a later task: every popstate listener of this pop has run by then, whatever their order.
    setTimeout(() => {
      unwinding = false
    }, 0)
  }
  const timer = setTimeout(finish, 1000)
  window.addEventListener('popstate', finish)
  history.go(-steps)
}
