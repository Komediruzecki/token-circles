/**
 * How the Accounts page shows an account's type: the badge's word, its colour and the card's icon.
 *
 * In cloud mode the page gets each account's type as the Worker stored it, so a row older versions
 * saved still says `checking` or `retirement`. The badge's word read it as the type that replaced
 * it, but the colour and the icon read it raw: a giro badge in the plain grey, with the plain icon.
 * All three now read the type the same way, and a type this build does not have is a plain
 * account in all three.
 *
 * The word is the type's name as the account form lists it (first-week test run, B7): the cards
 * showed the stored id, "giro" or "credit".
 */
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_TYPE_NAMES,
  accountTypeBadge,
  accountTypeIcon,
  accountTypeTone,
} from '../accountTypes'

describe('a type v4 renamed shows as the type that replaced it', () => {
  it.each([
    ['checking', 'giro'],
    ['investment', 'ib'],
    ['retirement', 'ib'],
  ])('%s shows as %s: word, colour and icon', (stored, replacement) => {
    expect(accountTypeBadge(stored)).toBe(accountTypeBadge(replacement))
    expect(accountTypeTone(stored)).toBe(accountTypeTone(replacement))
    expect(accountTypeIcon(stored)).toBe(accountTypeIcon(replacement))
  })
})

describe('each type has its own colour and icon', () => {
  it('gives the four types the colours the page has always used, and a credit card its own', () => {
    expect(['giro', 'savings', 'ib', 'cash', 'credit'].map(accountTypeTone)).toEqual([
      'primary',
      'success',
      'info',
      'warning',
      'expense',
    ])
  })

  it('gives no two types the same icon, and none the plain one', () => {
    const icons = ['giro', 'savings', 'ib', 'cash', 'credit'].map(accountTypeIcon)
    expect(new Set(icons).size).toBe(5)
    expect(icons).not.toContain(accountTypeIcon('sock_drawer'))
  })
})

describe('the badge says each type as the account form names it', () => {
  it('reads Giro / Checking, Savings, Investment / Brokerage, Cash and Credit Card', () => {
    expect(['giro', 'savings', 'ib', 'cash', 'credit', 'checking'].map(accountTypeBadge)).toEqual([
      'Giro / Checking',
      'Savings',
      'Investment / Brokerage',
      'Cash',
      'Credit Card',
      'Giro / Checking',
    ])
  })
})

describe('a credit card is a type this build has', () => {
  it('shows its own word, not the plain account', () => {
    expect(accountTypeBadge('credit')).toBe(ACCOUNT_TYPE_NAMES.credit)
    expect(accountTypeTone('credit')).not.toBe('default')
  })
})

describe('a type this build does not have is a plain account', () => {
  it.each(['sock_drawer'])(
    '%s: "Other account", as the form says, in the plain colour',
    (stored) => {
      expect(accountTypeBadge(stored)).toBe('Other account')
      expect(accountTypeTone(stored)).toBe('default')
    }
  )

  it('does not take a type from the prototype chain', () => {
    expect(accountTypeTone('constructor')).toBe('default')
    expect(accountTypeIcon('constructor')).toBe(accountTypeIcon('sock_drawer'))
  })
})
