/**
 * The separator rules, and the two things worth telling the user about.
 *
 * `1.234` is genuinely 1234 in one locale and 1.234 in another, and the string alone cannot say
 * which — no library resolves that, they only move the guess behind a configured locale. The rule
 * here is money-shaped: a lone separator is a decimal point, because prices carry cents. That is
 * also the rule that can be wrong, which is what `ambiguous-separator` exists to surface.
 */
import { describe, expect, it } from 'vitest'
import {
  describeImportNumberFlags,
  parseImportNumber,
  parseImportNumberDetailed,
} from '../../../../shared/importNumber'

describe('separator rules', () => {
  it.each([
    // both separators — the LAST one is the decimal point
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['1,234,567.89', 1234567.89],
    ['1.234.567,89', 1234567.89],
    // one character used repeatedly — grouping, no fraction
    ['1.234.567', 1234567],
    ['1,234,567', 1234567],
    // exactly one separator — a decimal point, always
    ['1,12', 1.12],
    ['1.12', 1.12],
    ['1234,56', 1234.56],
    ['1.000', 1],
    // none
    ['1234', 1234],
    // spaces only ever group
    ['1 234,56', 1234.56],
    ['1 234 567,89', 1234567.89],
    // signs and accounting negatives survive
    ['-1.234,56', -1234.56],
    ['(1,234.56)', -1234.56],
  ])('parses %j', (input, expected) => {
    expect(parseImportNumber(input)).toBeCloseTo(expected as number, 8)
  })

  it.each(['', 'abc', '1,2,3', '1,23,456', '1.234,567.89', '1  234', '12 34', '(-1,234.56)'])(
    'still rejects malformed %j',
    (input) => {
      // Relaxing which separator means "decimal" is deliberate; accepting nonsense is not.
      expect(parseImportNumber(input)).toBeNull()
    }
  )
})

describe('rounding to cents', () => {
  it.each([
    ['754.312', 754.31],
    ['1.2345', 1.23],
    ['3.9039', 3.9],
    ['3.575', 3.58], // half rounds up
    ['25.9025', 25.9],
  ])('rounds %j to cents', (input, expected) => {
    expect(parseImportNumber(input)).toBeCloseTo(expected as number, 8)
  })

  it('rounds a numeric cell too', () => {
    expect(parseImportNumber(754.312)).toBeCloseTo(754.31, 8)
  })
})

describe('flags', () => {
  it('flags a lone separator with three digits as ambiguous', () => {
    expect(parseImportNumberDetailed('1.234').flags).toContain('ambiguous-separator')
    expect(parseImportNumberDetailed('1.000').flags).toContain('ambiguous-separator')
  })

  it('does not flag a two-digit or four-digit fraction as ambiguous', () => {
    // Grouping is always exactly three digits, so neither shape can be grouping.
    expect(parseImportNumberDetailed('1.23').flags).toEqual([])
    expect(parseImportNumberDetailed('1.2345').flags).toEqual(['rounded'])
  })

  it('flags a value that rounding actually moved', () => {
    expect(parseImportNumberDetailed('754.312').flags).toContain('rounded')
  })

  // A sheet that multiplies to convert a currency stores binary-float residue in hundreds of
  // rows. Warning about 67.60000000000001 -> 67.60 would bury the handful that matter.
  it.each([67.60000000000001, 23.400000000000002, 60.580000000000005])(
    'stays quiet about float residue in %j',
    (input) => {
      const result = parseImportNumberDetailed(input)
      expect(result.flags).toEqual([])
      expect(result.value).toBeCloseTo(Math.round((input as number) * 100) / 100, 8)
    }
  )

  it('says something useful about each flag', () => {
    expect(describeImportNumberFlags('amount_local', '1.234', ['ambiguous-separator'])).toContain(
      'three digits after the separator'
    )
    expect(describeImportNumberFlags('amount', '1.2345', ['rounded'])).toContain('rounded to cents')
    expect(describeImportNumberFlags('amount', '1.23', [])).toBeNull()
  })
})
