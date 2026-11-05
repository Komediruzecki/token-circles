/**
 * The rules and words the sign-in, password and support forms share with the Worker
 * (shared/signInSchema.ts). These pin the edges: what a form refuses before it sends is exactly
 * what the route behind it refuses.
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
  STORED_EMAIL_PATTERN,
  storedEmailProblem,
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
    expect(EMAIL_PATTERN.flags).toBe('')
  })
})

/**
 * Real addresses, in the shapes people have: each is one an account can be created with, moved to
 * and written to support from.
 */
const REAL_SHAPED = [
  'name@example.test',
  'first.last@example.test',
  'name+budget@example.test',
  "o'brien@example.test",
  'mary-jane@mail.example.test',
  'a.b-c+d_e@sub.domain.example.test',
  'user123@123.example.test',
  'zoë@example.test',
  'josé.garcía@exämple.test',
  'ivana.čačić@primjer.test',
  'пользователь@пример.test',
  '用户@例子.test',
  'a@b.c',
]

/** One address per kind the stored check refuses, the two that started this first. */
const REFUSED_WHEN_STORED: [string, string][] = [
  ['a terminal title sequence (ESC, BEL)', 'a\x1b]0;T\x07@example.test'],
  ['markup', '<b>x</b>@example.test'],
  ['a NUL', 'na\x00me@example.test'],
  ['a C0 control in the domain', 'name@exam\x01ple.test'],
  ['a DEL', 'name\x7f@example.test'],
  ['a C1 control', 'name\u0085x@example.test'],
  ['a C1 control (CSI)', 'name@example.te\u009bst'],
  ['a right-to-left override', 'name\u202e@example.test'],
  ['a left-to-right isolate', 'name@\u2066example.test'],
  ['a zero-width space', 'na\u200bme@example.test'],
  ['a zero-width joiner', 'name@exa\u200dmple.test'],
  ['a soft hyphen', 'na\u00adme@example.test'],
  ['an opening angle bracket', 'name<@example.test'],
  ['a closing angle bracket', 'name@example.test>'],
  ['a space', 'na me@example.test'],
  ['a tab', 'name@exa\tmple.test'],
  ['a line break', 'name@example.test\nBcc: x@example.test'],
]

describe('an address an account is created with, moved to, or written to support from', () => {
  it('takes every address of a real shape', () => {
    for (const address of REAL_SHAPED) {
      expect(STORED_EMAIL_PATTERN.test(address), address).toBe(true)
      expect(storedEmailProblem(address), address).toBeUndefined()
      expect(storedEmailProblem(`  ${address} `), address).toBeUndefined()
    }
  })

  it('refuses control characters, format characters, angle brackets and spaces', () => {
    for (const [kind, address] of REFUSED_WHEN_STORED) {
      expect(STORED_EMAIL_PATTERN.test(address), kind).toBe(false)
      expect(storedEmailProblem(address), kind).toBe(SAY.emailFormat)
    }
  })

  it('refuses what the lookup pattern refuses, in the same words', () => {
    expect(storedEmailProblem('')).toBe(SAY.email)
    expect(storedEmailProblem('   ')).toBe(SAY.email)
    for (const typed of ['name', 'name@example', '@example.com', 'a@b@example.test']) {
      expect(storedEmailProblem(typed), typed).toBe(SAY.emailFormat)
    }
  })

  it('leaves the lookup pattern taking them, so an account that has one still signs in and resets', () => {
    for (const [kind, address] of REFUSED_WHEN_STORED) {
      // Whitespace was refused before, and still is.
      if (/\s/.test(address)) continue
      expect(EMAIL_PATTERN.test(address), kind).toBe(true)
      expect(emailProblem(address), kind).toBeUndefined()
      expect(addressProblems({ email: address }), kind).toEqual({})
    }
  })

  it('is the check registration and support use, and lookups do not', () => {
    const markup = '<b>x</b>@example.test'
    expect(registrationProblems({ email: markup, password: '12345678' })).toEqual({
      email: SAY.emailFormat,
    })
    expect(supportProblems({ email: markup, message: 'Hello there' })).toEqual({
      email: SAY.emailFormat,
    })
    expect(addressProblems({ email: markup })).toEqual({})
    expect(emailCodeProblems({ email: markup, code: '123456' })).toEqual({})
    expect(signInProblems({ email: markup, password: 'x' })).toEqual({})
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
