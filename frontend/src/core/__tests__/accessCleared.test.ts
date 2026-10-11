/**
 * The notice that the step a person took (Google sign-in, an emailed code, a reset) confirmed
 * their address and removed what was set up on the account before it. The routes name what went
 * (worker: clearedWorthSaying) and each ends in a reload, so the step and the names cross it in
 * sessionStorage and the notice is shown once, on the screen it was meant for. It names only what
 * went, in one sentence, then the one next step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLEARED_KINDS, readClearedKinds } from '../../../../shared/accessCleared'
import {
  accessClearedNotice,
  CLEARED_NAMES,
  consumeAccessClearedRedirect,
  markAccessCleared,
  takeAccessCleared,
} from '../accessCleared'
import type { ClearedBy, ClearedKind } from '../accessCleared'

beforeEach(() => {
  sessionStorage.clear()
  history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const STEPS: ClearedBy[] = ['google', 'email-code', 'reset']

/** Every combination of kinds, the empty one included. */
const COMBINATIONS: ClearedKind[][] = Array.from({ length: 2 ** CLEARED_KINDS.length }, (_, n) =>
  CLEARED_KINDS.filter((_, i) => n & (1 << i))
)

/** The notice's two sentences: what happened, then the next step. */
function sentences(words: string): { happened: string; next: string } {
  const parts = words.split(/(?<=\.) /)
  expect(parts, words).toHaveLength(2)
  return { happened: parts[0], next: parts[1] }
}

describe('markAccessCleared and takeAccessCleared', () => {
  it('hands the step and what went over once, to the app after a sign-in', () => {
    markAccessCleared('google', ['password', 'passkeys'])

    expect(takeAccessCleared('app')).toEqual({ by: 'google', kinds: ['password', 'passkeys'] })
    expect(takeAccessCleared('app')).toBeNull()
  })

  it('hands a reset over to the sign-in screen, and leaves it for the app', () => {
    markAccessCleared('reset', ['passkeys'])

    expect(takeAccessCleared('app')).toBeNull()
    expect(takeAccessCleared('sign-in-screen')).toEqual({ by: 'reset', kinds: ['passkeys'] })
  })

  it('leaves an emailed-code sign-in for the app, not the sign-in screen', () => {
    markAccessCleared('email-code', ['password'])

    expect(takeAccessCleared('sign-in-screen')).toBeNull()
    expect(takeAccessCleared('app')).toEqual({ by: 'email-code', kinds: ['password'] })
  })

  it('keeps nothing when nothing went', () => {
    markAccessCleared('google', [])

    expect(sessionStorage.length).toBe(0)
    expect(takeAccessCleared('app')).toBeNull()
  })

  it('removes a kept value it does not recognise', () => {
    for (const kept of [
      'sign-in:password',
      'reset',
      'google:',
      'google:nothing',
      '',
      'constructor:password',
      'toString:password',
    ]) {
      sessionStorage.setItem('tc:access-cleared', kept)

      expect(takeAccessCleared('app'), kept).toBeNull()
      expect(sessionStorage.getItem('tc:access-cleared'), kept).toBeNull()
    }
  })

  it('does without when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(() => {
      markAccessCleared('google', ['password'])
    }).not.toThrow()
    expect(takeAccessCleared('app')).toBeNull()
  })
})

describe('readClearedKinds', () => {
  it('reads names with space around them', () => {
    expect(readClearedKinds(' password , passkeys')).toEqual(['password', 'passkeys'])
    expect(readClearedKinds([' two-factor '])).toEqual(['two-factor'])
  })
})

describe('consumeAccessClearedRedirect', () => {
  it('reads the ?cleared= Google sign-in adds, and strips only that', () => {
    history.replaceState(null, '', '/?cleared=password%2Cpasskeys&keep=yes#settings')

    consumeAccessClearedRedirect()

    expect(takeAccessCleared('app')).toEqual({ by: 'google', kinds: ['password', 'passkeys'] })
    expect(window.location.search).toBe('?keep=yes')
    expect(window.location.hash).toBe('#settings')
  })

  it('strips a value that names nothing it knows, and keeps no notice', () => {
    history.replaceState(null, '', '/?cleared=1')

    consumeAccessClearedRedirect()

    expect(takeAccessCleared('app')).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('leaves an address without it alone', () => {
    history.replaceState(null, '', '/?twofa=1')

    consumeAccessClearedRedirect()

    expect(takeAccessCleared('app')).toBeNull()
    expect(window.location.search).toBe('?twofa=1')
  })
})

describe('the words', () => {
  it('after Google sign-in removed only the password', () => {
    expect(accessClearedNotice('google', ['password'])).toBe(
      'Signing in with Google confirmed your email, so your password no longer works. To set a new one, sign out and choose Forgot password.'
    )
  })

  it('after an emailed code removed only the password', () => {
    expect(accessClearedNotice('email-code', ['password'])).toBe(
      'Signing in with an emailed code confirmed your email, so your password no longer works. To set a new one, sign out and choose Forgot password.'
    )
  })

  it('after a sign-in that removed the password and more', () => {
    expect(
      accessClearedNotice('google', ['password', 'passkeys', 'two-factor', 'api-tokens'])
    ).toBe(
      'Signing in with Google confirmed your email, so your password, passkeys and API tokens no longer work, and two-factor authentication is off. To set a new password, sign out and choose Forgot password.'
    )
  })

  it('after a sign-in that left the password alone', () => {
    expect(accessClearedNotice('google', ['two-factor'])).toBe(
      'Signing in with Google confirmed your email, so two-factor authentication is off. Set it up again in Settings.'
    )
    expect(accessClearedNotice('email-code', ['passkeys'])).toBe(
      'Signing in with an emailed code confirmed your email, so your passkeys no longer work. Set them up again in Settings.'
    )
  })

  it('after a reset', () => {
    expect(accessClearedNotice('reset', ['passkeys', 'api-tokens'])).toBe(
      'Resetting your password confirmed your email, so your passkeys and API tokens no longer work. Sign in, then set them up again in Settings.'
    )
    expect(accessClearedNotice('reset', ['two-factor'])).toBe(
      'Resetting your password confirmed your email, so two-factor authentication is off. Sign in, then set it up again in Settings.'
    )
  })

  it('say nothing when nothing went', () => {
    for (const by of STEPS) expect(accessClearedNotice(by, [])).toBeNull()
  })

  it('never name the password after a reset, which has just set one', () => {
    expect(accessClearedNotice('reset', ['password'])).toBeNull()
    expect(accessClearedNotice('reset', ['password', 'api-tokens'])).toBe(
      'Resetting your password confirmed your email, so your API tokens no longer work. Sign in, then set them up again in Settings.'
    )
  })

  for (const by of STEPS) {
    it(`after ${by}, say what happened in one sentence and the next step in one, naming every kind that went and none that did not, in every combination`, () => {
      for (const kinds of COMBINATIONS) {
        const words = accessClearedNotice(by, kinds)
        const named = kinds.filter((kind) => by !== 'reset' || kind !== 'password')
        if (named.length === 0) {
          expect(words, kinds.join()).toBeNull()
          continue
        }
        const { happened, next } = sentences(words!)
        // What went is named after the step that removed it.
        const went = happened.slice(happened.indexOf(', so ') + ', so '.length)
        for (const kind of CLEARED_KINDS) {
          expect(went.includes(CLEARED_NAMES[kind]), `${kind} in "${words}"`).toBe(
            named.includes(kind)
          )
        }
        // Forgot password is the next step only when the password went, and only signed in.
        expect(next.includes('Forgot password'), words!).toBe(named.includes('password'))
        expect(next.startsWith('Sign in,'), words!).toBe(by === 'reset')
        expect(words, words!).not.toContain('—')
      }
    })
  }
})
