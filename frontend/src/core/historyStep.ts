/**
 * A history entry for a step that lives only in memory, so the system back gesture can leave it.
 *
 * The sign-in screen's steps after the form (a code by email, the second factor, Check your inbox)
 * are a signal, not a route. In an installed app on Android the back gesture pops a history entry,
 * and with none to pop it closes the app: someone on the code step had to kill the app to get back
 * to the form. So entering a step pushes ONE entry (same URL, same hash, a marker in its state), and
 * popping it runs the step's own way back.
 *
 * - The entry is pushed when `active` turns true and taken back (history.back()) when it turns
 *   false by any route other than the pop, so leaving through the step's own Back neither grows
 *   history nor leaves an entry that swallows the next back gesture.
 * - Moving from one step to another (a code by email to the second factor) keeps `active` true, so
 *   the steps share the one entry.
 * - The URL never changes, so there is no hashchange: App.tsx's hash routing does not see any of it.
 * - A sign-in reloads the page, and a reload keeps the current entry. `afterHistoryStep` takes the
 *   entry back first, so the signed-in app does not start one step ahead of where it loaded, with a
 *   back gesture that only reloads it.
 */
import { createEffect, on, onCleanup } from 'solid-js'

const MARK = 'tcHistoryStep'

/** Set while `afterHistoryStep` takes the entry back: the step stays on screen until the reload. */
let unwinding = false

function ours(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && (state as Record<string, unknown>)[MARK] === true
  )
}

export function createHistoryStep(options: {
  /** True while a step is on screen. */
  active: () => boolean
  /** The step's own way back, run when the back gesture pops the entry. */
  back: () => void
  /**
   * The URL for the entry under the step, when it should differ from the one the step is on: the
   * second factor arrives with ?twofa=1, which only the step's own entry should keep.
   */
  below?: () => string | undefined
}): void {
  createEffect(
    on(options.active, (active, was) => {
      if (active && !was) {
        if (ours(history.state)) return
        const state = history.state as unknown
        const below = options.below?.()
        try {
          if (below !== undefined && below !== window.location.href) {
            const here = window.location.href
            history.replaceState(state, '', below)
            history.pushState({ ...(state as object), [MARK]: true }, '', here)
          } else {
            history.pushState({ ...(state as object), [MARK]: true }, '')
          }
        } catch {
          // A history that refuses the entry leaves the step as it was before: Back still works.
        }
      } else if (!active && was && ours(history.state)) {
        // Left by the step's own Back. When the gesture left it, the pop already happened and the
        // current entry is unmarked; one still marked is the step's, to take back.
        history.back()
      }
    })
  )

  const onPop = () => {
    if (unwinding) return
    if (options.active() && !ours(history.state)) options.back()
  }
  window.addEventListener('popstate', onPop)
  onCleanup(() => {
    window.removeEventListener('popstate', onPop)
  })
}

/**
 * Run `then` once the step's entry is gone: at once when there is none, else after history.back()
 * lands (or a second at most, so a history that never answers cannot hold a sign-in up).
 */
export function afterHistoryStep(then: () => void): void {
  if (!ours(history.state)) {
    then()
    return
  }
  unwinding = true
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    window.removeEventListener('popstate', finish)
    clearTimeout(timer)
    then()
    // On a later task: every popstate listener of this pop has run by then, whatever their order.
    setTimeout(() => {
      unwinding = false
    }, 0)
  }
  const timer = setTimeout(finish, 1000)
  window.addEventListener('popstate', finish)
  history.back()
}
