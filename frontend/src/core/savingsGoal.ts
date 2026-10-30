/**
 * The savings goal, per profile (design.md 2.3, D13): `savingsGoal` in the answers record, which
 * Dashboard's savings gauge reads and sets.
 *
 * Before that, Dashboard kept one goal per browser under `localStorage.savingsGoal`, 20 unless it
 * was changed. A goal other than 20 moves to the first profile that opens Dashboard without a goal
 * of its own, and the browser's copy is then cleared, as the badge record was
 * (achievementsStore.ts): left in place, it would be handed to every other profile too. 20 was only
 * the default, so it moves nowhere and is cleared. A save that fails keeps the copy for the next
 * visit.
 */
import { takeAnswers } from './guidance'
import { saveAnswers } from './guidanceAnswers'
import type { GuidanceView } from './guidance'

/** Where the browser kept the goal before it was the profile's. */
export const BROWSER_GOAL_KEY = 'savingsGoal'

/** The goal shown when there is none of the person's own and no band to aim for. */
export const DEFAULT_SAVINGS_GOAL = 20

function forget(): void {
  try {
    localStorage.removeItem(BROWSER_GOAL_KEY)
  } catch {
    // Storage is blocked: there is nothing to move either.
  }
}

/** The browser's goal, when it is one worth moving: a percent from 0 to 100, other than 20. */
function browserGoal(): number | null | undefined {
  let raw: string | null
  try {
    raw = localStorage.getItem(BROWSER_GOAL_KEY)
  } catch {
    return undefined
  }
  if (raw === null) return undefined
  // Dashboard read it with parseFloat, so read it the same way.
  const goal = parseFloat(raw)
  return Number.isFinite(goal) && goal >= 0 && goal <= 100 && goal !== DEFAULT_SAVINGS_GOAL
    ? goal
    : null
}

let moving: Promise<void> | null = null

/**
 * Move the browser's goal to the profile `view` is for, once, and hand the circles the answers it
 * stored. Resolves when it has moved, been cleared, or failed to save.
 */
export function adoptBrowserGoal(view: GuidanceView): Promise<void> {
  if (moving) return moving
  const goal = browserGoal()
  if (goal === undefined) return Promise.resolve()
  if (goal === null || view.inputs.answers.savingsGoal !== undefined) {
    forget()
    return Promise.resolve()
  }
  const profileId = view.profileId
  moving = saveAnswers({ savingsGoal: goal }, profileId)
    .then((answers) => {
      forget()
      takeAnswers(profileId, answers)
    })
    .catch(() => {
      // Kept: the next visit to Dashboard tries again.
    })
    .finally(() => {
      moving = null
    })
  return moving
}
