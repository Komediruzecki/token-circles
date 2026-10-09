/**
 * ResetPassword: the link is checked and the password set on the account server, whatever mode
 * the browser was in. When the reset also confirmed the address and cleared what the account had
 * set up, the worker answers cleared: true, and the news is kept for the sign-in screen the page
 * reloads onto.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let resetAnswer: { cleared: boolean } = { cleared: false }
/** What the page did, in order: the mode it chose and the calls it made. */
let steps: string[] = []

vi.mock('../../core/api', () => ({
  api: {
    validateResetToken: () => {
      steps.push('check')
      return Promise.resolve(true)
    },
    resetPassword: () => {
      steps.push('reset')
      return Promise.resolve(resetAnswer)
    },
  },
}))
vi.mock('../../core/storage/storageFactory', () => ({
  setStorageMode: (mode: string) => {
    steps.push(`mode:${mode}`)
  },
}))
vi.mock('../SupportContact', () => ({ default: () => null }))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  resetAnswer = { cleared: false }
  steps = []
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

describe('the link', () => {
  it('is checked on the account server, in a browser that started local-first too', async () => {
    const { default: ResetPassword } = await import('../ResetPassword')
    dispose = render(() => <ResetPassword />, host)
    await settle()

    expect(steps).toEqual(['mode:self-hosted', 'check'])
  })

  it('sets the password there as well', async () => {
    await resetTo('a-new-password')

    expect(steps.slice(0, 3)).toEqual(['mode:self-hosted', 'check', 'reset'])
  })
})

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
