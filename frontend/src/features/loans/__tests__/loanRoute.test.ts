/**
 * The Loans page's addresses: a comparison lives in the URL (decision R7), so the URL has to
 * carry it there and back exactly, and survive being edited by hand.
 */
import { describe, expect, it } from 'vitest'
import { formatPick, loansHash, parseLoansHash, parsePick } from '../loanRoute'
import type { LoansRoute, ScenarioPick } from '../loanRoute'

const PICKS: [ScenarioPick, string][] = [
  [
    { choice: { template: 'more-each-month', amount: 50 }, mode: 'shorten' },
    'more-each-month.50.shorten',
  ],
  [{ choice: { template: 'round-up', target: 1100 }, mode: 'shorten' }, 'round-up.1100'],
  [
    { choice: { template: 'one-payment', amount: 10000, inMonths: 12 }, mode: 'lower' },
    'one-payment.10000.12.lower',
  ],
  [
    { choice: { template: 'yearly-bonus', amount: 2000, monthOfYear: 12 }, mode: 'both' },
    'yearly-bonus.2000.12.both',
  ],
  [
    { choice: { template: 'extra-installment', monthOfYear: 6 }, mode: 'shorten' },
    'extra-installment.6.shorten',
  ],
  [{ choice: { template: 'done-by', yearsEarlier: 2 }, mode: 'shorten' }, 'done-by.2'],
  [{ choice: { template: 'rate-change', points: -1 }, mode: 'shorten' }, 'rate-change.-1'],
]

describe('a pick in the address', () => {
  it('is written the way the plan spells it', () => {
    for (const [pick, text] of PICKS) expect(formatPick(pick)).toBe(text)
  })

  it('reads back exactly what was written, for every template', () => {
    for (const [pick, text] of PICKS) {
      expect(parsePick(text)).toEqual(pick)
      expect(formatPick(parsePick(text)!)).toBe(text)
    }
  })

  it('finishes sooner when a template that takes a mode has none written', () => {
    expect(parsePick('more-each-month.100')).toEqual({
      choice: { template: 'more-each-month', amount: 100 },
      mode: 'shorten',
    })
  })

  it('ignores a mode written after a template that takes none', () => {
    expect(parsePick('done-by.1.lower')).toEqual({
      choice: { template: 'done-by', yearsEarlier: 1 },
      mode: 'shorten',
    })
    expect(parsePick('rate-change.2.both')?.mode).toBe('shorten')
  })

  it('is no pick at all when it cannot be read', () => {
    for (const text of [
      '',
      'nope',
      'more-each-month',
      'more-each-month.',
      'more-each-month.abc',
      'more-each-month.50.sideways',
      'more-each-month.50.lower.extra',
      'more-each-month.0',
      'more-each-month.-50',
      'more-each-month.1e3',
      'more-each-month.12.5',
      'one-payment.1000',
      'one-payment.1000.0',
      'one-payment.1000.1201',
      'yearly-bonus.1000.13',
      'yearly-bonus.1000.0',
      'extra-installment.December',
      'done-by.0',
      'rate-change.0',
      'rate-change.+1',
      'rate-change.101',
      'MORE-EACH-MONTH.50',
    ]) {
      expect(parsePick(text), text).toBeNull()
    }
    expect(parsePick(null)).toBeNull()
    expect(parsePick(undefined)).toBeNull()
  })
})

describe('parseLoansHash', () => {
  it('is null for another page', () => {
    expect(parseLoansHash('#transactions')).toBeNull()
    expect(parseLoansHash('')).toBeNull()
    expect(parseLoansHash('#loanz/1')).toBeNull()
  })

  it('is the overview for the page itself, with its query or a trailing slash', () => {
    expect(parseLoansHash('#loans')).toEqual({ view: 'overview' })
    expect(parseLoansHash('#loans?period=2026-10')).toEqual({ view: 'overview' })
    expect(parseLoansHash('#loans/')).toEqual({ view: 'overview' })
  })

  it('names a loan, its tab and the picks', () => {
    expect(
      parseLoansHash('#loans/12/compare?b=one-payment.10000.12.lower&a=more-each-month.100.shorten')
    ).toEqual({
      view: 'loan',
      loanId: 12,
      tab: 'compare',
      b: { choice: { template: 'one-payment', amount: 10000, inMonths: 12 }, mode: 'lower' },
      a: { choice: { template: 'more-each-month', amount: 100 }, mode: 'shorten' },
    })
    expect(parseLoansHash('#loans/7/schedule')).toEqual({
      view: 'loan',
      loanId: 7,
      tab: 'schedule',
      b: null,
      a: null,
    })
    expect(parseLoansHash('#loans/7/extras?period=2026-10')).toMatchObject({ tab: 'extras' })
  })

  it('opens Compare for a loan named without a tab, or with one it does not have', () => {
    expect(parseLoansHash('#loans/7')).toMatchObject({ loanId: 7, tab: 'compare' })
    expect(parseLoansHash('#loans/7/')).toMatchObject({ loanId: 7, tab: 'compare' })
    expect(parseLoansHash('#loans/7/payments')).toMatchObject({ loanId: 7, tab: 'compare' })
  })

  it('names no loan for an id that cannot be one', () => {
    for (const hash of [
      '#loans/abc',
      '#loans/-3/compare',
      '#loans/1.5',
      '#loans/99999999999999999',
    ]) {
      expect(parseLoansHash(hash), hash).toMatchObject({ view: 'loan', loanId: 0 })
    }
  })

  it('drops a pick it cannot read and keeps the other', () => {
    expect(parseLoansHash('#loans/3/compare?b=garbage&a=done-by.1')).toMatchObject({
      b: null,
      a: { choice: { template: 'done-by', yearsEarlier: 1 } },
    })
  })

  it('pins one scenario, never both modes at once', () => {
    expect(parseLoansHash('#loans/3/compare?a=more-each-month.50.both')).toMatchObject({
      a: { mode: 'shorten' },
    })
  })
})

describe('loansHash', () => {
  it('writes a route that reads back as itself', () => {
    const routes: LoansRoute[] = [
      { view: 'overview' },
      { view: 'loan', loanId: 4, tab: 'schedule', b: null, a: null },
      { view: 'loan', loanId: 4, tab: 'compare', b: PICKS[2][0], a: null },
      { view: 'loan', loanId: 4, tab: 'compare', b: PICKS[3][0], a: PICKS[0][0] },
      { view: 'loan', loanId: 4, tab: 'extras', b: PICKS[5][0], a: PICKS[6][0] },
    ]
    for (const route of routes) expect(parseLoansHash(loansHash(route))).toEqual(route)
  })

  it('writes b before a, as the plan spells the address', () => {
    expect(
      loansHash({ view: 'loan', loanId: 12, tab: 'compare', b: PICKS[2][0], a: PICKS[0][0] })
    ).toBe('#loans/12/compare?b=one-payment.10000.12.lower&a=more-each-month.50.shorten')
  })

  it("keeps the rest of the app's query, and replaces the picks", () => {
    const keep = new URLSearchParams('b=done-by.1&period=2026-10&a=done-by.2')
    expect(
      loansHash({ view: 'loan', loanId: 2, tab: 'compare', b: PICKS[0][0], a: null }, keep)
    ).toBe('#loans/2/compare?b=more-each-month.50.shorten&period=2026-10')
    expect(loansHash({ view: 'overview' }, keep)).toBe('#loans?period=2026-10')
  })
})

describe('round up in the address', () => {
  it('reads a mode an older address wrote as finishing sooner: round up pays what it names', () => {
    for (const mode of ['shorten', 'lower', 'both']) {
      expect(parsePick(`round-up.1100.${mode}`)).toEqual({
        choice: { template: 'round-up', target: 1100 },
        mode: 'shorten',
      })
    }
    expect(formatPick({ choice: { template: 'round-up', target: 1100 }, mode: 'lower' })).toBe(
      'round-up.1100'
    )
  })
})
