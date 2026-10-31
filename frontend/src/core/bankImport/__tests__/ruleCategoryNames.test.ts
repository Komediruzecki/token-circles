/**
 * The category names the built-in bank-import rules give.
 *
 * A newcomer's first import offers every one of these that the space does not have yet, so each
 * must be a name anyone would pick for their own books: a default category, or a general name on
 * the list below. The Croatian rules once shipped 'Salary Eur', 'Apartment (Bills)' and
 * 'Car (Gas)', one person's own labels, and a stranger's first import offered them all.
 *
 * Adding a rule category means adding its name here, which is the moment to ask whether it is
 * general.
 */
import { describe, expect, it } from 'vitest'
import { RETIRED_RULE_CATEGORY_NAMES } from '../../../../../shared/bankImport/categoryAliases'
import { RULE_GROUPS } from '../../../../../shared/bankImport/categoryRules'
import { DEFAULT_CATEGORIES } from '../../storage/idb'

/** General names a rule may give besides the default categories. */
const GENERAL_RULE_CATEGORIES = [
  'Bank Fees',
  'Dining',
  'Fuel',
  'Groceries',
  'Health',
  'Income',
  'Restaurant',
  'Transfers',
  'Transport',
  'Travel',
]

const ALLOWED = new Set([...DEFAULT_CATEGORIES.map((c) => c.name), ...GENERAL_RULE_CATEGORIES])

describe('bank-import rule category names', () => {
  for (const group of RULE_GROUPS) {
    it(`the ${group.label} rules give only default or general category names`, () => {
      const unexpected = group.rules.map((r) => r.category).filter((name) => !ALLOWED.has(name))
      expect(unexpected).toEqual([])
    })
  }

  it('no rule gives a retired name again', () => {
    const retired = new Set(Object.keys(RETIRED_RULE_CATEGORY_NAMES).map((n) => n.toLowerCase()))
    const given = RULE_GROUPS.flatMap((g) => g.rules.map((r) => r.category.toLowerCase()))
    expect(given.filter((name) => retired.has(name))).toEqual([])
  })

  it('every retired name points at a name a rule gives now, one old name per new name', () => {
    const given = new Set(RULE_GROUPS.flatMap((g) => g.rules.map((r) => r.category)))
    const targets = Object.values(RETIRED_RULE_CATEGORY_NAMES)
    for (const target of targets) expect(given.has(target)).toBe(true)
    // Two old names on one new name could not be told apart again at import time.
    expect(new Set(targets.map((t) => t.toLowerCase())).size).toBe(targets.length)
  })
})
