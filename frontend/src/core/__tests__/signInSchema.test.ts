/**
 * The rules and words the sign-in, password and support forms share with the Worker
 * (shared/signInSchema.ts). Each rule is one a route already had, so these pin the edges: what a
 * form refuses before it sends is exactly what the route behind it refuses.
 */
import { describe, expect, it } from 'vitest'
import {
  addressProblems,
  EMAIL_PATTERN,
  emailCodeProblems,
  emailProblem,
  newPasswordProblem,
  noProblems,
  registrationProblems,
  resetPasswordProblems,
  SIGN_IN_MESSAGES as SAY,
  signInProblems,
  supportProblems,
} from '../../../../shared/signInSchema'

describe('an address', () => {
  it('is something@something.something, after the space around it is trimmed', () => {
    expect(emailProblem('name@example.com')).toBeUndefined()
    expect(emailProblem('  name@example.com  ')).toBeUndefined()
    expect(emailProblem('a@b.c')).toBeUndefined()
  })

  it('says what to type when it is missing or not an address', () => {
    expect(emailProblem('')).toBe(SAY.email)
    expect(emailProblem('   ')).toBe(SAY.email)
    for (const typed of [
      'name',
      'name@example',
      '@example.com',
      'name@.com x',
      'na me@example.com',
    ]) {
      expect(emailProblem(typed), typed).toBe(SAY.emailFormat)
    }
  })

  it('uses the pattern the routes tested before it moved here', () => {
    expect(EMAIL_PATTERN.source).toBe(String.raw`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
  })
})

describe('a new password', () => {
  it('has at least 8 characters, spaces counted as the routes count them', () => {
    expect(newPasswordProblem('1234567')).toBe(SAY.newPassword)
    expect(newPasswordProblem('12345678')).toBeUndefined()
    expect(newPasswordProblem('        ')).toBeUndefined()
  })
})

describe('signing in', () => {
  it('needs both fields, and checks no format and no length', () => {
    expect(signInProblems({ email: '', password: '' })).toEqual({
      email: SAY.email,
      password: SAY.password,
    })
    expect(signInProblems({ email: 'no-at-sign', password: 'x' })).toEqual({})
  })
})

describe('creating an account', () => {
  it('needs an address in the format and a password of 8 characters', () => {
    expect(registrationProblems({ email: 'name@example', password: 'short' })).toEqual({
      email: SAY.emailFormat,
      password: SAY.newPassword,
    })
    expect(noProblems(registrationProblems({ email: 'a@b.co', password: '12345678' }))).toBe(true)
  })
})

describe('a reset link, a sign-in code and a new password', () => {
  it('check the address, the code and the password the routes check', () => {
    expect(addressProblems({ email: 'name@example' })).toEqual({ email: SAY.emailFormat })
    expect(addressProblems({ email: 'name@example.com' })).toEqual({})
    expect(emailCodeProblems({ email: 'name@example.com', code: ' ' })).toEqual({
      code: SAY.emailCode,
    })
    expect(emailCodeProblems({ email: 'name@example.com', code: '123456' })).toEqual({})
    expect(resetPasswordProblems({ password: 'short' })).toEqual({ password: SAY.newPassword })
  })
})

describe('a message to support', () => {
  it('is 5 to 5,000 characters once trimmed', () => {
    const at = (message: string) => supportProblems({ email: 'me@example.com', message }).message
    expect(at('  four  ')).toBe(SAY.supportMessage)
    expect(at('five!')).toBeUndefined()
    expect(at('x'.repeat(5000))).toBeUndefined()
    expect(at('x'.repeat(5001))).toBe(SAY.supportMessageLength)
  })
})

describe('the words', () => {
  it('are sentences that say what to do, with no em dash', () => {
    for (const words of Object.values(SAY)) {
      expect(words, words).toMatch(/^[A-Z].*\.$/)
      expect(words, words).not.toContain('—')
    }
  })
})
