/**
 * A history entry for a step that lives only in memory, so the system back gesture can leave it.
 *
 * The sign-in screen's steps after the form (a code by email, the second factor, Check your inbox)
 * and the sign-in dialog are a signal, not a route. In an installed app on Android the back gesture
 * pops a history entry, and with none to pop it closes the app: someone on the code step had to
 * kill the app to get back to the form. So entering a step pushes ONE entry (same URL, same hash,
 * its depth in the state), and popping it runs the step's own way back.
 *
 * - Entries carry their depth: `tcHistoryStep: 1` for the first step, 2 for a step opened on it (the
 *   dialog is 1, its own steps 2). A step handles a pop only when it lands below its own depth, so
 *   the gesture takes a step back to the dialog's form before the next one closes the dialog.
 * - Moving from one step to another (a code by email to the second factor) keeps `active` true, so
 *   the steps share the one entry.
 * - Leaving a step any way but the gesture (its own Back, the screen going away) takes its entry
 *   back, so history does not grow and the next gesture is not swallowed.
 * - Every way back goes through ONE traversal at a time (`goTo`). Browsers add up history.go()
 *   calls made before the first one lands, so a step's Back and a close in the same moment would
 *   otherwise go back past the page. A deeper request made meanwhile goes on from the landing.
 * - The URL never changes, so there is no hashchange: App.tsx's hash routing does not see any of it.
 * - A reload keeps the current entry. A sign-in reloads, so `afterHistoryStep` takes every step
 *   entry back first. A page reloaded (or restored after Android discarded it) while on a step
 *   comes back on the form with nobody owning that entry, and takes it back on mount.
 */
import { createEffect, on, onCleanup } from 'solid-js'

const MARK = 'tcHistoryStep'

/** The depth a traversal is on its way to; null when none is. */
let target: number | null = null
/** Set from a traversal's landing until the next task, so every listener of that pop ignores it. */
let settling = false
/** What waits for the traversal to land. */
let waiting: (() => void)[] = []
let fallback: ReturnType<typeof setTimeout> | undefined
/** The depths of the steps on screen now, so an entry nobody owns can be told apart. */
const owned = new Set<number>()

/** How many step entries the current one sits on top of, counting itself; 0 when it is no step's. */
function depth(state: unknown): number {
  if (typeof state !== 'object' || state === null) return 0
  const mark = (state as Record<string, unknown>)[MARK]
  return typeof mark === 'number' && mark > 0 ? mark : 0
}

/** Where history is, or is on its way to. */
function current(): number {
  return target ?? depth(history.state)
}

function topOwned(): number {
  let top = 0
  for (const d of owned) top = Math.max(top, d)
  return top
}

/** Runs what waits, every one of them even when one throws; the first error is rethrown. */
function finish(traversed: boolean) {
  window.removeEventListener('popstate', landed)
  clearTimeout(fallback)
  target = null
  if (traversed) {
    settling = true
    setTimeout(() => {
      settling = false
    }, 0)
  }
  const run = waiting
  waiting = []
  let failed: { error: unknown } | undefined
  for (const next of run) {
    try {
      next()
    } catch (error) {
      failed ??= { error }
    }
  }
  if (failed) throw failed.error
}

/** A traversal landed: done when it reached `target`, else one more go() from where it is. */
function landed() {
  if (target === null) return
  const here = depth(history.state)
  if (here > target) traverse(target - here)
  else finish(true)
}

function traverse(delta: number) {
  clearTimeout(fallback)
  // A history that never answers cannot hold anything up for more than a second.
  fallback = setTimeout(() => {
    finish(true)
  }, 1000)
  history.go(delta)
}

/** Go back to the entry of depth `to` (or stay, when already at or below it), then run `then`. */
function goTo(to: number, then?: () => void) {
  if (then) waiting.push(then)
  if (target !== null) {
    // One traversal at a time: a deeper request goes on from where this one lands.
    target = Math.min(target, to)
    return
  }
  const here = depth(history.state)
  if (here <= to) {
    finish(false)
    return
  }
  target = to
  window.addEventListener('popstate', landed)
  traverse(to - here)
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
  const claim = (d: number) => {
    mine = d
    owned.add(d)
  }
  const release = () => {
    owned.delete(mine)
    mine = 0
  }
  /** Leaving without the gesture: the step's entry (and any above it) goes. */
  const leave = () => {
    const below = mine - 1
    release()
    if (current() > below) goTo(below)
  }

  const push = () => {
    if (!options.active() || mine > 0) return
    const state = history.state as unknown
    const next = depth(state) + 1
    const marked = { ...(state as object), [MARK]: next }
    const below = options.below?.()
    try {
      if (below !== undefined && below !== window.location.href) {
        const here = window.location.href
        history.replaceState(state, '', below)
        history.pushState(marked, '', here)
      } else {
        history.pushState(marked, '')
      }
      claim(next)
    } catch {
      // A history that refuses the entry leaves the step as it was before: Back still works.
    }
  }

  createEffect(
    on(options.active, (active, was) => {
      if (was === undefined) {
        // First run. An entry above the steps on screen belongs to nobody: a page reloaded on a
        // step lands on one, and the gesture from it would only pop to an identical page.
        const top = topOwned()
        const here = current()
        if (active && target === null && here === top + 1) {
          // Reloaded on this very step (the second factor reopens on ?twofa=1): it is ours.
          claim(here)
          return
        }
        if (here > top) {
          goTo(top, active ? push : undefined)
          return
        }
      }
      if (active && !was) {
        if (target !== null) goTo(current(), push)
        else push()
      } else if (!active && was && mine > 0) {
        // Left by the step's own Back. When the gesture left it, the pop already released it.
        leave()
      }
    })
  )

  const onPop = () => {
    if (target !== null || settling) return
    if (options.active() && mine > 0 && depth(history.state) < mine) {
      release()
      options.back()
    }
  }
  window.addEventListener('popstate', onPop)
  onCleanup(() => {
    window.removeEventListener('popstate', onPop)
    // Gone without its Back or the gesture (the screen swapped out under it): the entry goes too.
    if (mine > 0) leave()
  })
}

/**
 * Run `then` once every step entry is gone: at once when there is none, else after the traversal
 * lands (or a second at most). A second call while one is on its way joins it.
 */
export function afterHistoryStep(then: () => void): void {
  goTo(0, then)
}
