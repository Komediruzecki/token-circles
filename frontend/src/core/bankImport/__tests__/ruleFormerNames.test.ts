/**
 * A built-in rule that now gives a default name keeps filing a space's rows under the name it gave
 * before, wherever the space still has that category.
 *
 * Two rules can give one name: the Croatian fuel and parking rules both give Transportation. The
 * name a row arrives with can then no longer say which old name it stands for, so a name-level
 * alias cannot keep 'Car (Gas)' and 'Transport' apart. Each rule remembers the names it gave before
 * (CategoryRule.formerly), and the row is filed when the rule categorizes it, given the names of
 * the space's categories. Every description below is made up.
 */
import { describe, expect, it } from 'vitest'
import {
  categorize,
  DEFAULT_CATEGORY_RULES,
  DEFAULT_CATEGORY_RULES_WORLDWIDE,
  matchCategory,
} from '../../../../../shared/bankImport/categoryRules'
import { DEFAULT_CATEGORIES } from '../../storage/idb'
import type { CategoryRuleSet } from '../../../../../shared/bankImport/types'

const CROATIAN = DEFAULT_CATEGORY_RULES
const WORLDWIDE = DEFAULT_CATEGORY_RULES_WORLDWIDE
const DEFAULTS = DEFAULT_CATEGORIES.map((c) => c.name)

/** The category a rule set gives `text` in a space whose categories are `categoryNames`. */
const fileUnder = (text: string, rules: CategoryRuleSet, categoryNames: string[]) =>
  categorize([text], rules, { categoryNames })

describe('the Croatian rules in a space with the default categories', () => {
  it('file fuel, parking and the pharmacy under the defaults', () => {
    expect(fileUnder('PETROL TEST STATION 0000', CROATIAN, DEFAULTS)).toBe('Transportation')
    expect(fileUnder('PARKING TEST GARAGE 0000', CROATIAN, DEFAULTS)).toBe('Transportation')
    expect(fileUnder('ZET TEST TICKET 0000', CROATIAN, DEFAULTS)).toBe('Transportation')
    expect(fileUnder('LJEKARNA TEST 0000', CROATIAN, DEFAULTS)).toBe('Healthcare')
  })
})

describe('the Croatian rules in a space that holds the names they gave before', () => {
  it('file fuel under Car (Gas) and parking under Transport, beside the defaults', () => {
    const space = [...DEFAULTS, 'Car (Gas)', 'Transport']
    expect(fileUnder('PETROL TEST STATION 0000', CROATIAN, space)).toBe('Car (Gas)')
    expect(fileUnder('PARKING TEST GARAGE 0000', CROATIAN, space)).toBe('Transport')
    expect(fileUnder('ZET TEST TICKET 0000', CROATIAN, space)).toBe('Transport')
  })

  it('keep filing parking under Transport when the space has no Car (Gas)', () => {
    expect(fileUnder('PARKING TEST GARAGE 0000', CROATIAN, ['Transport'])).toBe('Transport')
    // Fuel never went to Transport, so it does not start now.
    expect(fileUnder('PETROL TEST STATION 0000', CROATIAN, ['Transport'])).toBe('Transportation')
  })

  it('file each renamed rule under its own old name', () => {
    const space = [
      ...DEFAULTS,
      'Car (Gas)',
      'Transport',
      'Health',
      'Apartment (Bills)',
      'Salary Eur',
    ]
    expect(fileUnder('LJEKARNA TEST 0000', CROATIAN, space)).toBe('Health')
    expect(fileUnder('HEP TEST INVOICE 0000', CROATIAN, space)).toBe('Apartment (Bills)')
    expect(fileUnder('ISPLATA PLACE TEST EMPLOYER', CROATIAN, space)).toBe('Salary Eur')
  })

  it('match an old name case-blind and give it as the space spells it', () => {
    const space = ['car (gas)', ' TRANSPORT ']
    expect(fileUnder('PETROL TEST STATION 0000', CROATIAN, space)).toBe('car (gas)')
    expect(fileUnder('PARKING TEST GARAGE 0000', CROATIAN, space)).toBe('TRANSPORT')
  })
})

describe('the Worldwide rules', () => {
  it('file rides, fuel and the pharmacy under the defaults', () => {
    expect(fileUnder('UBER TEST TRIP 0000', WORLDWIDE, DEFAULTS)).toBe('Transportation')
    expect(fileUnder('SHELL TEST STATION 0000', WORLDWIDE, DEFAULTS)).toBe('Transportation')
    expect(fileUnder('PHARMACY TEST 0000', WORLDWIDE, DEFAULTS)).toBe('Healthcare')
  })

  it('keep Transport, Fuel and Health apart in a space that has them', () => {
    const space = [...DEFAULTS, 'Transport', 'Fuel', 'Health']
    expect(fileUnder('UBER TEST TRIP 0000', WORLDWIDE, space)).toBe('Transport')
    expect(fileUnder('SHELL TEST STATION 0000', WORLDWIDE, space)).toBe('Fuel')
    expect(fileUnder('PHARMACY TEST 0000', WORLDWIDE, space)).toBe('Health')
  })
})

describe('a rule with former names', () => {
  it('gives the oldest one the space has, else its name now', () => {
    // A rule renamed twice: Car (Gas), then Transportation, then Car.
    const rules = [
      { category: 'Car', formerly: ['Car (Gas)', 'Transportation'], keywords: ['fuel'] },
    ]
    expect(fileUnder('test fuel', rules, ['Transportation', 'Car (Gas)'])).toBe('Car (Gas)')
    expect(fileUnder('test fuel', rules, ['Transportation'])).toBe('Transportation')
    expect(fileUnder('test fuel', rules, ['Groceries'])).toBe('Car')
  })

  it('folds with another rule into one name and still files each apart', () => {
    // How Restaurant (Croatian) and Dining (Worldwide) can fold into Eating out later.
    const rules = [
      { category: 'Eating out', formerly: ['Restaurant'], keywords: ['restoran'] },
      { category: 'Eating out', formerly: ['Dining'], keywords: ['pizza'] },
    ]
    expect(fileUnder('RESTORAN TEST', rules, ['Restaurant', 'Dining'])).toBe('Restaurant')
    expect(fileUnder('PIZZA TEST', rules, ['Restaurant', 'Dining'])).toBe('Dining')
    expect(fileUnder('PIZZA TEST', rules, ['Eating out'])).toBe('Eating out')
  })

  it('gives its name now when the caller passes no categories', () => {
    expect(matchCategory('PETROL TEST STATION 0000', CROATIAN)).toBe('Transportation')
    expect(matchCategory('PARKING TEST GARAGE 0000', CROATIAN)).toBe('Transportation')
    expect(categorize(['LJEKARNA TEST 0000'], CROATIAN)).toBe('Healthcare')
  })
})

describe('badminton', () => {
  it('is not a transport keyword', () => {
    // It was one person's own rule. A space that has Transport no longer gets it there either.
    expect(fileUnder('BADMINTON TEST CLUB 0000', CROATIAN, ['Transport'])).toBe('Other')
    expect(matchCategory('BADMINTON TEST CLUB 0000', CROATIAN)).toBeNull()
  })
})
