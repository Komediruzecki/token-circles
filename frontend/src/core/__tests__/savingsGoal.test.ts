/**
 * The savings goal moves from the browser to the profile (design.md 2.3, D13): a goal other than
 * 20 goes to the first profile that opens Dashboard without one of its own, once, and the
 * browser's copy is cleared; 20 was only the default and is cleared without a save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adoptBrowserGoal, BROWSER_GOAL_KEY } from '../savingsGoal'
import type { Answers } from '../../../../shared/guidance/answers'
import type { GuidanceView } from '../guidance'

const saves = vi.hoisted(() => ({ fail: false, calls: [] as Array<[unknown, unknown]> }))

vi.mock('../guidanceAnswers', () => ({
  saveAnswers: vi.fn(async (changes: Answers, profileId: number) => {
    saves.calls.push([changes, profileId])
    if (saves.fail) throw new Error('offline')
    return changes
  }),
}))
vi.mock('../guidance', () => ({ takeAnswers: vi.fn() }))

import { takeAnswers } from '../guidance'

const view = (answers: Answers = {}, profileId = 3): GuidanceView =>
  ({ profileId, inputs: { profileId, answers } }) as unknown as GuidanceView

beforeEach(() => {
  saves.fail = false
  saves.calls = []
  vi.mocked(takeAnswers).mockClear()
  localStorage.removeItem(BROWSER_GOAL_KEY)
})
afterEach(() => {
  localStorage.removeItem(BROWSER_GOAL_KEY)
})

describe("the browser's savings goal", () => {
  it('moves to the first profile without a goal, and is then cleared', async () => {
    localStorage.setItem(BROWSER_GOAL_KEY, '15')
    await adoptBrowserGoal(view())
    expect(saves.calls).toEqual([[{ savingsGoal: 15 }, 3]])
    expect(takeAnswers).toHaveBeenCalledWith(3, { savingsGoal: 15 })
    expect(localStorage.getItem(BROWSER_GOAL_KEY)).toBeNull()

    // Cleared, so the next profile gets nothing.
    await adoptBrowserGoal(view({}, 4))
    expect(saves.calls).toHaveLength(1)
  })

  it('is cleared without a save when it is 20, the old default, or not a goal', async () => {
    for (const stored of ['20', '120', '-1', 'not a number']) {
      localStorage.setItem(BROWSER_GOAL_KEY, stored)
      await adoptBrowserGoal(view())
      expect(localStorage.getItem(BROWSER_GOAL_KEY), stored).toBeNull()
    }
    expect(saves.calls).toEqual([])
  })

  it("leaves a profile's own goal as it is, and clears the browser's", async () => {
    localStorage.setItem(BROWSER_GOAL_KEY, '15')
    await adoptBrowserGoal(view({ savingsGoal: 30 }))
    expect(saves.calls).toEqual([])
    expect(localStorage.getItem(BROWSER_GOAL_KEY)).toBeNull()
  })

  it('stays in the browser when the save fails, for the next visit', async () => {
    localStorage.setItem(BROWSER_GOAL_KEY, '12.5')
    saves.fail = true
    await adoptBrowserGoal(view())
    expect(saves.calls).toEqual([[{ savingsGoal: 12.5 }, 3]])
    expect(takeAnswers).not.toHaveBeenCalled()
    expect(localStorage.getItem(BROWSER_GOAL_KEY)).toBe('12.5')
  })

  it('moves once while a save is on its way', async () => {
    localStorage.setItem(BROWSER_GOAL_KEY, '15')
    await Promise.all([adoptBrowserGoal(view()), adoptBrowserGoal(view())])
    expect(saves.calls).toHaveLength(1)
  })

  it('does nothing without one', async () => {
    await adoptBrowserGoal(view())
    expect(saves.calls).toEqual([])
  })
})
