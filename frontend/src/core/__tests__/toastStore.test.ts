/**
 * toastStore — the queue behind every toast.
 *
 * Covers what callers rely on: channels replace instead of stack (the app-update notice must
 * never pile up), an explicit duration outlives the default, and dismissal — manual or by
 * channel — cancels the pending auto-dismiss rather than leaving a timer to fire into nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function freshStore() {
  vi.resetModules()
  return await import('../toastStore')
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // Orphaned auto-dismiss timers from this test's store must not fire into the next test's
  // clock, and the fake clock must not leak past this file.
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('toastStore', () => {
  it('stacks unrelated toasts, newest last', async () => {
    const store = await freshStore()
    store.addToast('first', 'info')
    store.addToast('second', 'success')

    expect(store.toasts().map((t) => t.message)).toEqual(['first', 'second'])
  })

  it('replaces the previous toast on the same channel instead of stacking', async () => {
    const store = await freshStore()
    store.addToast('old notice', 'info', { channel: 'app-update' })
    store.addToast('new notice', 'info', { channel: 'app-update' })

    expect(store.toasts().map((t) => t.message)).toEqual(['new notice'])
  })

  it('auto-dismisses after the default for its type', async () => {
    const store = await freshStore()
    store.addToast('done', 'success')

    vi.advanceTimersByTime(4999)
    expect(store.toasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(store.toasts()).toHaveLength(0)
  })

  it('honours an explicit durationMs over the default', async () => {
    const store = await freshStore()
    store.addToast('decide', 'info', { durationMs: 60_000 })

    vi.advanceTimersByTime(10_000)
    expect(store.toasts()).toHaveLength(1)
    vi.advanceTimersByTime(50_000)
    expect(store.toasts()).toHaveLength(0)
  })

  it('carries title and action through to the rendered item', async () => {
    const store = await freshStore()
    const onClick = vi.fn()
    store.addToast('a new version is ready', 'info', {
      title: 'Update',
      action: { label: 'Reload', onClick },
    })

    const [item] = store.toasts()
    expect(item.title).toBe('Update')
    expect(item.action?.label).toBe('Reload')
    item.action?.onClick()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('removes a toast on demand and cancels its pending timer', async () => {
    const store = await freshStore()
    store.addToast('closable', 'info')
    const [item] = store.toasts()

    store.removeToast(item.id)
    expect(store.toasts()).toHaveLength(0)
    // The timer was cancelled with it — advancing time must not throw or double-remove.
    vi.advanceTimersByTime(60_000)
    expect(store.toasts()).toHaveLength(0)
  })

  it('caps the stack, dropping the oldest toasts', async () => {
    const store = await freshStore()
    for (let i = 1; i <= 6; i++) store.addToast(`toast ${i}`, 'info')

    expect(store.toasts().map((t) => t.message)).toEqual([
      'toast 3',
      'toast 4',
      'toast 5',
      'toast 6',
    ])
  })

  it('falls back to the default duration for a non-finite override', async () => {
    const store = await freshStore()
    store.addToast('sticky attempt', 'info', { durationMs: Infinity })

    vi.advanceTimersByTime(5000)
    expect(store.toasts()).toHaveLength(0)
  })

  it('clears a whole channel, leaving other toasts alone', async () => {
    const store = await freshStore()
    store.addToast('update notice', 'info', { channel: 'app-update' })
    store.addToast('saved', 'success')

    store.removeToastsByChannel('app-update')
    expect(store.toasts().map((t) => t.message)).toEqual(['saved'])
  })
})
