import { describe, expect, it } from 'vitest'
import { confirmRequests, resolveConfirm, showConfirm } from '../confirmStore'

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
