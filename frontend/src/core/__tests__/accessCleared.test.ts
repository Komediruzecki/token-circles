/**
 * The notice that confirming an address removed what was set up on the account before it. The
 * routes name what went (worker: clearedWorthSaying) and each ends in a reload, so the names cross
 * it in sessionStorage and the notice is shown once, on the screen it was meant for. It names only
 * what went.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLEARED_KINDS } from '../../../../shared/accessCleared'
import {
  accessClearedNotice,
  CLEARED_NAMES,
  consumeAccessClearedRedirect,
  markAccessCleared,
  takeAccessCleared,
} from '../accessCleared'
import type { ClearedKind } from '../accessCleared'

beforeEach(() => {
  sessionStorage.clear()
  history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Every combination of kinds, the empty one included. */
const COMBINATIONS: ClearedKind[][] = Array.from({ length: 2 ** CLEARED_KINDS.length }, (_, n) =>
  CLEARED_KINDS.filter((_, i) => n & (1 << i))
)

describe('markAccessCleared and takeAccessCleared', () => {
  it('hands what went over once', () => {
    markAccessCleared('sign-in', ['password', 'passkeys'])

    expect(takeAccessCleared('sign-in')).toEqual(['password', 'passkeys'])
    expect(takeAccessCleared('sign-in')).toEqual([])
  })

  it('keeps nothing when nothing went', () => {
    markAccessCleared('sign-in', [])

    expect(sessionStorage.length).toBe(0)
    expect(takeAccessCleared('sign-in')).toEqual([])
  })

  it('leaves a notice for the other screen where it is', () => {
    markAccessCleared('reset', ['passkeys'])

    expect(takeAccessCleared('sign-in')).toEqual([])
    expect(takeAccessCleared('reset')).toEqual(['passkeys'])
  })

  it('does without when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => {
      markAccessCleared('sign-in', ['password'])
    }).not.toThrow()
    expect(takeAccessCleared('sign-in')).toEqual([])
  })
})

describe('consumeAccessClearedRedirect', () => {
  it('reads the ?cleared= Google sign-in adds, and strips only that', () => {
    history.replaceState(null, '', '/?cleared=password%2Cpasskeys&keep=yes#settings')

    consumeAccessClearedRedirect()

    expect(takeAccessCleared('sign-in')).toEqual(['password', 'passkeys'])
    expect(window.location.search).toBe('?keep=yes')
    expect(window.location.hash).toBe('#settings')
  })

  it('strips a value that names nothing it knows, and keeps no notice', () => {
    history.replaceState(null, '', '/?cleared=1')

    consumeAccessClearedRedirect()

    expect(takeAccessCleared('sign-in')).toEqual([])
    expect(window.location.search).toBe('')
  })

  it('leaves an address without it alone', () => {
    history.replaceState(null, '', '/?twofa=1')

    consumeAccessClearedRedirect()

    expect(takeAccessCleared('sign-in')).toEqual([])
    expect(window.location.search).toBe('?twofa=1')
  })
})

describe('the words', () => {
  it('after a sign-in that removed only the password', () => {
    expect(accessClearedNotice('sign-in', ['password'])).toBe(
      'Confirming your email removed the password you signed up with. To set a new password, choose Forgot password on the sign-in screen.'
    )
  })

  it('after a sign-in that removed the password and more', () => {
    expect(accessClearedNotice('sign-in', ['password', 'passkeys', 'two-factor'])).toBe(
      'Confirming your email removed the password you signed up with, your passkeys and two-factor authentication. To set a new password, choose Forgot password on the sign-in screen.'
    )
  })

  it('after a sign-in that left no password to remove', () => {
    expect(accessClearedNotice('sign-in', ['two-factor'])).toBe(
      'Confirming your email removed two-factor authentication. Add it again in Settings.'
    )
    expect(accessClearedNotice('sign-in', ['passkeys', 'api-tokens'])).toBe(
      'Confirming your email removed your passkeys and your API tokens. Add them again in Settings.'
    )
  })

  it('after a reset', () => {
    expect(accessClearedNotice('reset', ['passkeys'])).toBe(
      'Your new password is set, and confirming your email removed your passkeys. Sign in, then add them again in Settings.'
    )
    expect(accessClearedNotice('reset', ['two-factor'])).toBe(
      'Your new password is set, and confirming your email removed two-factor authentication. Sign in, then add it again in Settings.'
    )
  })

  it('say nothing when nothing went', () => {
    expect(accessClearedNotice('sign-in', [])).toBeNull()
    expect(accessClearedNotice('reset', [])).toBeNull()
  })

  it('never name the password after a reset, which has just set one', () => {
    expect(accessClearedNotice('reset', ['password'])).toBeNull()
    expect(accessClearedNotice('reset', ['password', 'api-tokens'])).toBe(
      'Your new password is set, and confirming your email removed your API tokens. Sign in, then add them again in Settings.'
    )
  })

  for (const by of ['sign-in', 'reset'] as const) {
    it(`after a ${by}, name every kind that went and none that did not, in every combination`, () => {
      for (const kinds of COMBINATIONS) {
        const words = accessClearedNotice(by, kinds)
        const named = kinds.filter((kind) => by === 'sign-in' || kind !== 'password')
        if (named.length === 0) {
          expect(words, kinds.join()).toBeNull()
          continue
        }
        for (const kind of CLEARED_KINDS) {
          const said = words!.includes(CLEARED_NAMES[kind])
          expect(said, `${kind} in "${words}"`).toBe(named.includes(kind))
        }
        // Forgot password is the next step only when the password went.
        expect(words!.includes('Forgot password'), words!).toBe(named.includes('password'))
      }
    })
  }

  it('use no em dash', () => {
    for (const by of ['sign-in', 'reset'] as const) {
      for (const kinds of COMBINATIONS) {
        expect(accessClearedNotice(by, kinds) ?? '').not.toContain('—')
      }
    }
  })
})
