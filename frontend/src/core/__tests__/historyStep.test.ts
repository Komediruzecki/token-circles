/**
 * afterHistoryStep takes every step entry back before it runs what waits on it. A second call while
 * the first is still on its way joins it: one traversal, both run. A second history.go() would be
 * counted from wherever the first had not yet landed, and browsers add them up, taking the app
 * back past the page the steps were on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BEFORE = { test: 'before the steps' }

function popped(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener(
      'popstate',
      () => {
        resolve()
      },
      { once: true }
    )
  })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.resetModules()
  history.pushState(BEFORE, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('afterHistoryStep', () => {
  it('runs at once when no step entry is current', async () => {
    const { afterHistoryStep } = await import('../historyStep')
    const go = vi.spyOn(history, 'go')
    let ran = 0
    afterHistoryStep(() => (ran += 1))

    expect(ran).toBe(1)
    expect(go).not.toHaveBeenCalled()
  })

  it('takes two nested step entries back in one go, then runs', async () => {
    const { afterHistoryStep } = await import('../historyStep')
    history.pushState({ ...BEFORE, tcHistoryStep: 1 }, '')
    history.pushState({ ...BEFORE, tcHistoryStep: 2 }, '')
    const go = vi.spyOn(history, 'go')
    let ran = 0
    const landed = popped()
    afterHistoryStep(() => (ran += 1))
    expect(ran).toBe(0)
    await landed
    await settle()

    expect(go.mock.calls).toEqual([[-2]])
    expect(ran).toBe(1)
    expect(history.state).toEqual(BEFORE)
  })

  it('joins a second call made while the first is on its way', async () => {
    const { afterHistoryStep } = await import('../historyStep')
    history.pushState({ ...BEFORE, tcHistoryStep: 1 }, '')
    const go = vi.spyOn(history, 'go')
    const ran: string[] = []
    const landed = popped()
    afterHistoryStep(() => ran.push('first'))
    afterHistoryStep(() => ran.push('second'))
    await landed
    await settle()

    expect(go.mock.calls).toEqual([[-1]])
    expect(ran).toEqual(['first', 'second'])
    expect(history.state).toEqual(BEFORE)
  })
})
