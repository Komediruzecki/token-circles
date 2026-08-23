/**
 * ResendVerification — one request at a time, a terminal "sent", and a failure that gives the
 * user their button back rather than leaving them on a disabled one with no way forward.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const toasts: { message: string; type: string }[] = []
let calls = 0
let send: () => Promise<void> = () => Promise.resolve()

async function mount(variant?: 'inline' | 'button') {
  vi.resetModules()
  vi.doMock('../../core/api', () => ({
    toast: (message: string, type = 'info') => toasts.push({ message, type }),
  }))
  vi.doMock('../../core/emailVerification', () => ({
    resendVerificationEmail: () => {
      calls += 1
      return send()
    },
  }))
  const { ResendVerification } = await import('../ResendVerification')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <ResendVerification variant={variant} />, host)
}

const btn = () => host.querySelector<HTMLButtonElement>('button')
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  toasts.length = 0
  calls = 0
  send = () => Promise.resolve()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.doUnmock('../../core/api')
  vi.doUnmock('../../core/emailVerification')
  vi.resetModules()
})

describe('ResendVerification', () => {
  it('confirms the mail went, instead of looking untouched', async () => {
    await mount()

    btn()!.click()
    await flush()

    expect(calls).toBe(1)
    expect(btn()).toBeNull()
    expect(host.textContent).toContain('check your inbox')
  })

  it('sends once however many times it is clicked', async () => {
    let resolve!: () => void
    send = () => new Promise<void>((r) => (resolve = r))
    await mount()

    btn()!.click()
    await flush()
    btn()!.click()
    btn()!.click()
    resolve()
    await flush()

    expect(calls).toBe(1)
  })

  it('hands the button back after a failure, with the reason', async () => {
    send = () => Promise.reject(new Error('Too many requests — try again a little later'))
    await mount()

    btn()!.click()
    await flush()

    expect(btn()).not.toBeNull()
    expect(btn()!.disabled).toBe(false)
    expect(toasts).toEqual([
      { message: 'Too many requests — try again a little later', type: 'error' },
    ])
  })

  it('reads as a link inside running text when asked to', async () => {
    await mount('inline')

    expect(btn()!.className).toMatch(/inline/)
  })
})
