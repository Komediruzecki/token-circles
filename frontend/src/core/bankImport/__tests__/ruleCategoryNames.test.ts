/**
 * The category names the built-in bank-import rules give.
 *
 * A newcomer's first import offers every one of these that the space does not have yet, so each
 * must be a name anyone would pick for their own books, and not a second name for a default:
 * a default category, or a general name on the list below. The Croatian rules once shipped
 * 'Salary Eur', 'Apartment (Bills)' and 'Car (Gas)', one person's own labels, and both rule sets
 * gave 'Transport', 'Fuel' and 'Health' beside the defaults Transportation and Healthcare.
 *
 * A rule that gives a new name lists the old one in `formerly`, so a space that has a category
 * under the old name keeps getting the rule's rows there (ruleFormerNames.test.ts). An old name is
 * retired: no rule may give it again.
 *
 * Adding a rule category means adding its name here, which is the moment to ask whether it is
 * general.
 */
import { describe, expect, it } from 'vitest'
import { RULE_GROUPS } from '../../../../../shared/bankImport/categoryRules'
import { DEFAULT_CATEGORIES } from '../../storage/idb'

/**
 * General names a rule may give besides the default categories. Restaurant and Dining sit beside
 * the default Eating out until the rules give it themselves.
 */
const GENERAL_RULE_CATEGORIES = [
  'Bank Fees',
  'Dining',
  'Income',
  'Restaurant',
  'Transfers',
  'Travel',
]

/** Names the rules gave before, by rule group, and the name each rule gives instead. */
const RETIRED: Record<string, Array<[old: string, now: string]>> = {
  croatian: [
    ['Car (Gas)', 'Transportation'],
    ['Apartment (Bills)', 'Utilities'],
    ['Salary Eur', 'Salary'],
    ['Transport', 'Transportation'],
    ['Health', 'Healthcare'],
  ],
  worldwide: [
    ['Transport', 'Transportation'],
    ['Fuel', 'Transportation'],
    ['Health', 'Healthcare'],
  ],
}

const DEFAULT_NAMES = DEFAULT_CATEGORIES.map((c) => c.name)
const ALLOWED = new Set([...DEFAULT_NAMES, ...GENERAL_RULE_CATEGORIES])
/** A name however it is cased, spaced or punctuated: 'Health Care' and 'health-care' are one. */
const fold = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * Two names for one thing: they differ only in case, spaces or punctuation, or one is the other
 * with a few letters more at the end ('Transport' and 'Transportation', 'Health' and 'Healthcare',
 * 'Gift' and 'Gifts'). A synonym ('Medical') shares no spelling: the list of general names above,
 * which a new name has to join, is where that is caught.
 */
function nearDuplicate(a: string, b: string): boolean {
  const [short, long] = [fold(a), fold(b)].sort((x, y) => x.length - y.length)
  let common = 0
  while (common < short.length && short[common] === long[common]) common++
  return common >= Math.max(3, short.length - 2)
}

describe('bank-import rule category names', () => {
  for (const group of RULE_GROUPS) {
    it(`the ${group.label} rules give only default or general category names`, () => {
      const unexpected = group.rules.map((r) => r.category).filter((name) => !ALLOWED.has(name))
      expect(unexpected).toEqual([])
    })
  }

  it('no general name is a second name for a default category', () => {
    // The check knows the names it has to keep out.
    expect(nearDuplicate('Transport', 'Transportation')).toBe(true)
    expect(nearDuplicate('Health', 'Healthcare')).toBe(true)
    // However the name is spaced or punctuated.
    expect(nearDuplicate('Health Care', 'Healthcare')).toBe(true)
    expect(nearDuplicate('Health-care', 'Healthcare')).toBe(true)
    expect(nearDuplicate('Sub Scriptions', 'Subscriptions')).toBe(true)
    // And no more than that: these are names of their own.
    expect(nearDuplicate('Transfers', 'Transportation')).toBe(false)
    expect(nearDuplicate('Travel', 'Transportation')).toBe(false)
    expect(nearDuplicate('Bank Fees', 'Food')).toBe(false)
    const pairs = GENERAL_RULE_CATEGORIES.flatMap((general) =>
      DEFAULT_NAMES.filter((name) => nearDuplicate(general, name)).map((name) => [general, name])
    )
    expect(pairs).toEqual([])
  })

  it('no rule gives a name a rule gave before', () => {
    const retired = new Set([
      ...Object.values(RETIRED).flatMap((pairs) => pairs.map(([old]) => fold(old))),
      ...RULE_GROUPS.flatMap((g) => g.rules.flatMap((r) => (r.formerly ?? []).map(fold))),
    ])
    for (const name of ['Transport', 'Fuel', 'Health']) expect(retired.has(fold(name))).toBe(true)
    const given = RULE_GROUPS.flatMap((g) => g.rules.map((r) => r.category))
    expect(given.filter((name) => retired.has(fold(name)))).toEqual([])
  })

  for (const group of RULE_GROUPS) {
    it(`the ${group.label} rules remember every name they gave before`, () => {
      // A rule that forgot one would file a space's rows under the default beside it.
      for (const [old, now] of RETIRED[group.id] ?? []) {
        const keeper = group.rules.find((r) => r.category === now && r.formerly?.includes(old))
        expect(keeper, `${old} -> ${now}`).toBeDefined()
      }
    })
  }
})
