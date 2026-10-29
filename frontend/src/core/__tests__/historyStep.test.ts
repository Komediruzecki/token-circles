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

afterEach(async () => {
  for (const stop of unjournal.splice(0)) stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
  // A traversal one test started must land before the next test pushes its own entries.
  await new Promise((resolve) => setTimeout(resolve, 30))
})

const unjournal: (() => void)[] = []

/** Every history.go() and every popstate, in the order they happened. */
function journal(): string[] {
  const events: string[] = []
  const go = history.go.bind(history)
  vi.spyOn(history, 'go').mockImplementation((delta?: number) => {
    events.push(`go ${String(delta)}`)
    go(delta)
  })
  const pop = () => events.push('pop')
  window.addEventListener('popstate', pop)
  unjournal.push(() => {
    window.removeEventListener('popstate', pop)
  })
  return events
}

/** The helper and Solid, fresh, from the same module graph (beforeEach resets it). */
async function load() {
  return { ...(await import('solid-js')), ...(await import('../historyStep')) }
}

const until = async (done: () => boolean) => {
  for (let i = 0; i < 40 && !done(); i += 1) await settle()
}

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

describe('afterHistoryStep when something goes wrong', () => {
  it('runs anyway after a second when the traversal never lands', async () => {
    const { afterHistoryStep } = await import('../historyStep')
    history.pushState({ ...BEFORE, tcHistoryStep: 1 }, '')
    vi.useFakeTimers()
    vi.spyOn(history, 'go').mockImplementation(() => undefined)
    let ran = 0
    afterHistoryStep(() => (ran += 1))

    vi.advanceTimersByTime(999)
    expect(ran).toBe(0)
    vi.advanceTimersByTime(1)
    expect(ran).toBe(1)
  })

  it('a callback that throws does not stop the others, or the next traversal', async () => {
    const { afterHistoryStep } = await import('../historyStep')
    history.pushState({ ...BEFORE, tcHistoryStep: 1 }, '')
    vi.useFakeTimers()
    const go = vi.spyOn(history, 'go').mockImplementation(() => undefined)
    const ran: string[] = []
    afterHistoryStep(() => {
      throw new Error('boom')
    })
    afterHistoryStep(() => ran.push('second'))

    expect(() => vi.advanceTimersByTime(1000)).toThrow('boom')
    expect(ran).toEqual(['second'])
    afterHistoryStep(() => ran.push('third'))
    expect(go).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1000)
    expect(ran).toEqual(['second', 'third'])
  })
})

describe('createHistoryStep', () => {
  it("one traversal at a time: a step's Back and a close in the same moment end before the dialog", async () => {
    const { afterHistoryStep, createHistoryStep, createRoot, createSignal } = await load()
    let closed = 0
    const dialog = createRoot((dispose) => {
      const [stage, setStage] = createSignal('form')
      createHistoryStep({ active: () => true, back: () => undefined })
      createHistoryStep({ active: () => stage() !== 'form', back: () => setStage('form') })
      return { setStage, dispose }
    })
    await settle()
    dialog.setStage('code')
    await settle()
    expect(history.state).toEqual({ ...BEFORE, tcHistoryStep: 2 })
    const events = journal()

    dialog.setStage('form')
    afterHistoryStep(() => {
      closed += 1
      dialog.dispose()
    })
    await until(() => closed > 0)

    // Never a second go() before the first has landed: browsers would add them up.
    expect(events).toEqual(['go -1', 'pop', 'go -1', 'pop'])
    expect(closed).toBe(1)
    expect(history.state).toEqual(BEFORE)
  })

  it('takes its entry back when it goes away without its Back', async () => {
    const { createHistoryStep, createRoot } = await load()
    const step = createRoot((dispose) => {
      createHistoryStep({ active: () => true, back: () => undefined })
      return { dispose }
    })
    await settle()
    expect(history.state).toEqual({ ...BEFORE, tcHistoryStep: 1 })
    const events = journal()

    step.dispose()
    await until(() => events.includes('pop'))

    expect(events).toEqual(['go -1', 'pop'])
    expect(history.state).toEqual(BEFORE)
  })

  it('takes back an entry nobody owns when it mounts, as after a reload on a step', async () => {
    history.pushState({ ...BEFORE, tcHistoryStep: 1 }, '')
    const { createHistoryStep, createRoot } = await load()
    const events = journal()
    createRoot(() => {
      createHistoryStep({ active: () => false, back: () => undefined })
    })
    await until(() => events.includes('pop'))

    expect(events).toEqual(['go -1', 'pop'])
    expect(history.state).toEqual(BEFORE)
  })
})
