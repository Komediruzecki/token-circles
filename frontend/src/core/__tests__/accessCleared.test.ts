/**
 * The notice that confirming an address cleared what was set up on the account before it. The
 * routes say so (worker: clearedWorthSaying) and each ends in a reload, so the news crosses it in
 * sessionStorage and is shown once, on the screen it was meant for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCESS_CLEARED_NOTICE,
  consumeAccessClearedRedirect,
  markAccessCleared,
  takeAccessCleared,
} from '../accessCleared'

beforeEach(() => {
  sessionStorage.clear()
  history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('markAccessCleared and takeAccessCleared', () => {
  it('hands the notice over once', () => {
    markAccessCleared('sign-in')

    expect(takeAccessCleared('sign-in')).toBe(true)
    expect(takeAccessCleared('sign-in')).toBe(false)
  })

  it('leaves a notice for the other screen where it is', () => {
    markAccessCleared('reset')

    expect(takeAccessCleared('sign-in')).toBe(false)
    expect(takeAccessCleared('reset')).toBe(true)
  })

  it('does without when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => {
      markAccessCleared('sign-in')
    }).not.toThrow()
    expect(takeAccessCleared('sign-in')).toBe(false)
  })
})

describe('consumeAccessClearedRedirect', () => {
  it('reads the ?cleared=1 Google sign-in adds, and strips only that', () => {
    history.replaceState(null, '', '/?cleared=1&keep=yes#settings')

    consumeAccessClearedRedirect()

    expect(takeAccessCleared('sign-in')).toBe(true)
    expect(window.location.search).toBe('?keep=yes')
    expect(window.location.hash).toBe('#settings')
  })

  it('leaves an address without it alone', () => {
    history.replaceState(null, '', '/?twofa=1')

    consumeAccessClearedRedirect()

    expect(takeAccessCleared('sign-in')).toBe(false)
    expect(window.location.search).toBe('?twofa=1')
  })
})

describe('the words', () => {
  it('name what went and what to do after a sign-in', () => {
    const words = ACCESS_CLEARED_NOTICE['sign-in']
    for (const part of [
      'old password',
      'passkeys',
      'two-factor authentication',
      'API tokens',
      'other devices',
      'Settings',
      'Forgot password',
    ]) {
      expect(words).toContain(part)
    }
  })

  it('leave the password out after a reset, which has just set one', () => {
    const words = ACCESS_CLEARED_NOTICE.reset
    expect(words).toContain('new password is set')
    expect(words).not.toContain('old password')
    for (const part of ['passkeys', 'two-factor authentication', 'API tokens', 'other devices']) {
      expect(words).toContain(part)
    }
  })

  it('use no em dash', () => {
    for (const words of Object.values(ACCESS_CLEARED_NOTICE)) expect(words).not.toContain('—')
  })
})
