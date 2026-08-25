import { describe, expect, it, vi } from 'vitest'
import { acceptConfirm, confirmRequests, resolveConfirm, showConfirm } from '../confirmStore'

/** A promise the test resolves by hand, to hold `onConfirm` open mid-flight. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const lastId = () => confirmRequests().at(-1)!.id
const find = (id: number) => confirmRequests().find((r) => r.id === id)

describe('confirmStore', () => {
  it('defaults to Confirm/Cancel, non-danger', () => {
    const p = showConfirm('Sure?')
    const req = confirmRequests().at(-1)!
    expect(req.message).toBe('Sure?')
    expect(req.confirmText).toBe('Confirm')
    expect(req.cancelText).toBe('Cancel')
    expect(req.danger).toBe(false)
    resolveConfirm(req.id, false)
    return expect(p).resolves.toBe(false)
  })

  it('carries custom labels and the danger flag', () => {
    const p = showConfirm('Delete it?', { confirmText: 'Delete', danger: true })
    const req = confirmRequests().at(-1)!
    expect(req.confirmText).toBe('Delete')
    expect(req.danger).toBe(true)
    resolveConfirm(req.id, true)
    return expect(p).resolves.toBe(true)
  })

  it('resolves and removes only the targeted request', async () => {
    const a = showConfirm('A')
    const b = showConfirm('B')
    const [reqA, reqB] = confirmRequests().slice(-2)
    resolveConfirm(reqA.id, true)
    // B is still pending; A is gone from the queue.
    expect(confirmRequests().some((r) => r.id === reqA.id)).toBe(false)
    expect(confirmRequests().some((r) => r.id === reqB.id)).toBe(true)
    resolveConfirm(reqB.id, false)
    expect(await a).toBe(true)
    expect(await b).toBe(false)
  })
})

describe('confirmStore work mode', () => {
  it('closes immediately when no work is attached', async () => {
    const p = showConfirm('Sure?')
    const id = lastId()
    await acceptConfirm(id)
    expect(find(id)).toBeUndefined()
    await expect(p).resolves.toBe(true)
  })

  it('holds the dialog open until the work settles, then closes', async () => {
    const gate = deferred()
    const p = showConfirm('Delete 50?', { onConfirm: () => gate.promise })
    const id = lastId()
    const run = acceptConfirm(id)

    // The whole point: still on screen, and marked busy, while the request is in flight.
    expect(find(id)?.busy).toBe(true)
    gate.resolve()
    await run
    expect(find(id)).toBeUndefined()
    await expect(p).resolves.toBe(true)
  })

  it('cannot be dismissed while the work is in flight', async () => {
    const gate = deferred()
    const p = showConfirm('Delete 50?', { onConfirm: () => gate.promise })
    const id = lastId()
    const run = acceptConfirm(id)

    // An overlay click or Cancel here would resolve the caller's promise while its own
    // delete is still running, and the row would be left in an unknown state.
    resolveConfirm(id, false)
    expect(find(id)?.busy).toBe(true)
    gate.resolve()
    await run
    await expect(p).resolves.toBe(true)
  })

  it('surfaces progress reports on the open request', async () => {
    const gate = deferred()
    const p = showConfirm('Delete 3?', {
      onConfirm: (report) => {
        report({ label: 'Deleting 3 transactions…', done: 1, total: 3 })
        return gate.promise
      },
    })
    const id = lastId()
    const run = acceptConfirm(id)
    expect(find(id)?.progress).toEqual({
      label: 'Deleting 3 transactions…',
      done: 1,
      total: 3,
    })
    gate.resolve()
    await run
    await expect(p).resolves.toBe(true)
  })

  it('keeps the dialog open and names the reason when the work fails', async () => {
    let settled = false
    const p = showConfirm('Delete?', {
      onConfirm: () => Promise.reject(new Error('Network request failed')),
    })
    void p.then(() => {
      settled = true
    })
    const id = lastId()
    await acceptConfirm(id)

    // Failure stays on screen instead of going only to the console, and the caller is
    // NOT told the delete happened.
    expect(find(id)?.error).toBe('Network request failed')
    expect(find(id)?.busy).toBe(false)
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveConfirm(id, false)
    await expect(p).resolves.toBe(false)
  })

  it('offers a way out when the work never settles', async () => {
    // Holding the dialog shut is right while a request is in flight, but a request that never
    // settles — a socket that neither responds nor errors — would otherwise leave a
    // full-screen overlay with Cancel disabled and no keyboard route out, recoverable only by
    // reloading the page. That is worse than what this replaced, so it must not happen.
    vi.useFakeTimers()
    try {
      const p = showConfirm('Delete?', { onConfirm: () => new Promise<void>(() => undefined) })
      const id = lastId()
      void acceptConfirm(id)

      resolveConfirm(id, false)
      expect(find(id)?.busy).toBe(true)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(find(id)?.stalled).toBe(true)
      resolveConfirm(id, false)
      expect(find(id)).toBeUndefined()
      await expect(p).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('can retry after a failure and succeed', async () => {
    let attempts = 0
    const p = showConfirm('Delete?', {
      onConfirm: () => {
        attempts += 1
        return attempts === 1 ? Promise.reject(new Error('Timed out')) : Promise.resolve()
      },
    })
    const id = lastId()
    await acceptConfirm(id)
    expect(find(id)?.error).toBe('Timed out')

    await acceptConfirm(id)
    expect(find(id)).toBeUndefined()
    expect(attempts).toBe(2)
    await expect(p).resolves.toBe(true)
  })
})
