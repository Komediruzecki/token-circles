/**
 * How the confirm link signs in, in one place (shared/confirmLinkSignIn.ts): the rule the Worker's
 * sign-up marker follows, and the words the mails, Check your inbox and the refused sign-in say
 * about it. Turning the same-browser sign-in off, or changing how long it lasts, changes the words
 * with it.
 */
import { describe, expect, it } from 'vitest'
import {
  CONFIRM_LINK_SIGN_IN,
  inWords,
  notYourSignUp,
  whereTheLinkSignsIn,
} from '../../../../shared/confirmLinkSignIn'

describe('the rule', () => {
  it('signs in the browser that signed up, for an hour', () => {
    expect(CONFIRM_LINK_SIGN_IN).toEqual({ sameBrowser: true, seconds: 3600 })
  })
})

describe('the words', () => {
  it('say where and for how long the link signs in by itself, and what it does otherwise', () => {
    expect(whereTheLinkSignsIn()).toBe(
      "Open it within an hour in the browser you signed up in and you're signed in. Later, or anywhere else, it asks you to sign in first."
    )
    expect(whereTheLinkSignsIn('the link we emailed you')).toBe(
      "Open the link we emailed you within an hour in the browser you signed up in and you're signed in. Later, or anywhere else, it asks you to sign in first."
    )
  })

  it('follow a change to how long the link signs in', () => {
    expect(whereTheLinkSignsIn('it', { sameBrowser: true, seconds: 2 * 3600 })).toBe(
      "Open it within 2 hours in the browser you signed up in and you're signed in. Later, or anywhere else, it asks you to sign in first."
    )
  })

  it('ask for the password everywhere with the same-browser sign-in off', () => {
    const off = { sameBrowser: false, seconds: 3600 }
    expect(whereTheLinkSignsIn('it', off)).toBe('Open it, then sign in where it opens.')
    expect(notYourSignUp('Token Circles', off)).toBe(
      "Didn't sign up for Token Circles? Ignore this mail."
    )
  })

  it('tell someone who never signed up not to open the link while it signs in by itself', () => {
    expect(notYourSignUp('Token Circles')).toBe(
      "Didn't sign up for Token Circles? Don't open the link."
    )
  })

  it('put a length of time in words', () => {
    expect(inWords(3600)).toBe('an hour')
    expect(inWords(7200)).toBe('2 hours')
    expect(inWords(1800)).toBe('30 minutes')
    expect(inWords(90 * 60)).toBe('90 minutes')
    expect(inWords(60)).toBe('a minute')
    expect(inWords(10)).toBe('a minute')
  })
})
