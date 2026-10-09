/**
 * ResetPassword: when the reset also confirmed the address and cleared what the account had set
 * up, the worker answers cleared: true, and the news is kept for the sign-in screen the page
 * reloads onto.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let resetAnswer: { cleared: boolean } = { cleared: false }

vi.mock('../../core/api', () => ({
  api: {
    validateResetToken: () => Promise.resolve(true),
    resetPassword: () => Promise.resolve(resetAnswer),
  },
}))
vi.mock('../../core/storage/storageFactory', () => ({ setStorageMode: vi.fn() }))
vi.mock('../SupportContact', () => ({ default: () => null }))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  resetAnswer = { cleared: false }
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  vi.stubGlobal('location', {
    hash: '#reset-password?token=abc',
    reload: vi.fn(),
  } as unknown as Location)
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

async function resetTo(password: string) {
  const { default: ResetPassword } = await import('../ResetPassword')
  dispose = render(() => <ResetPassword />, host)
  await settle()
  const [first, second] = Array.from(host.querySelectorAll<HTMLInputElement>('input'))
  for (const input of [first, second]) {
    input.value = password
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
  await settle()
}

describe('a reset that cleared the account', () => {
  it('keeps the news for the sign-in screen', async () => {
    resetAnswer = { cleared: true }
    await resetTo('a-new-password')

    expect(host.textContent).toContain('Password updated.')
    expect(sessionStorage.getItem('tc:access-cleared')).toBe('reset')
  })

  it('keeps nothing when nothing was cleared', async () => {
    await resetTo('a-new-password')

    expect(host.textContent).toContain('Password updated.')
    expect(sessionStorage.getItem('tc:access-cleared')).toBeNull()
  })
})
