import { describe, expect, it } from 'vitest'
import {
  describeTagRuleCriteria,
  EMPTY_TAG_RULE_CRITERIA,
  isTagRuleCriteriaEmpty,
  normalizeTagRuleCriteria,
  splitTagRuleConditions,
  tagRuleScanNarrowing,
  transactionMatchesAnyTagRule,
  transactionMatchesTagRule,
} from '../../../../shared/tagRules'

/** Build criteria from a partial, so each test states only the condition it exercises. */
const criteria = (patch: Partial<ReturnType<typeof normalizeTagRuleCriteria>> = {}) => ({
  ...EMPTY_TAG_RULE_CRITERIA,
  ...patch,
})

const tx = (patch: Record<string, unknown> = {}) => ({
  type: 'expense',
  amount: 50,
  date: '2026-03-15',
  description: 'AWS cloud hosting',
  beneficiary: 'Amazon Web Services',
  payor: '',
  notes: '',
  means_of_payment: 'card',
  category_id: 7,
  account_id: 2,
  transfer_account_id: null,
  ...patch,
})

describe('normalizeTagRuleCriteria', () => {
  it('fills every field from an empty input', () => {
    expect(normalizeTagRuleCriteria({})).toEqual(EMPTY_TAG_RULE_CRITERIA)
    expect(normalizeTagRuleCriteria(undefined)).toEqual(EMPTY_TAG_RULE_CRITERIA)
    expect(normalizeTagRuleCriteria(null)).toEqual(EMPTY_TAG_RULE_CRITERIA)
  })

  it('parses a JSON string blob (how the rule is stored)', () => {
    const parsed = normalizeTagRuleCriteria(JSON.stringify({ description: 'AWS', match: 'any' }))
    expect(parsed.description).toBe('AWS')
    expect(parsed.match).toBe('any')
  })

  it('falls back to empty criteria when the stored blob is unreadable', () => {
    expect(normalizeTagRuleCriteria('{not json')).toEqual(EMPTY_TAG_RULE_CRITERIA)
  })

  it('drops unknown types, non-positive ids, and duplicates', () => {
    const parsed = normalizeTagRuleCriteria({
      types: ['expense', 'nope', 'income', 'expense'],
      categoryIds: [3, 3, 0, -2, '5', 'x'],
    })
    expect(parsed.types).toEqual(['expense', 'income'])
    expect(parsed.categoryIds).toEqual([3, 5])
  })

  it('rejects malformed dates rather than widening the rule', () => {
    expect(normalizeTagRuleCriteria({ dateFrom: '15/03/2026' }).dateFrom).toBeNull()
    expect(normalizeTagRuleCriteria({ dateFrom: '2026-03-15' }).dateFrom).toBe('2026-03-15')
  })

  it('swaps inverted amount and date bounds', () => {
    const amounts = normalizeTagRuleCriteria({ amountMin: 100, amountMax: 10 })
    expect(amounts.amountMin).toBe(10)
    expect(amounts.amountMax).toBe(100)

    const dates = normalizeTagRuleCriteria({ dateFrom: '2026-06-01', dateTo: '2026-01-01' })
    expect(dates.dateFrom).toBe('2026-01-01')
    expect(dates.dateTo).toBe('2026-06-01')
  })

  it('leaves a single-sided bound alone', () => {
    expect(normalizeTagRuleCriteria({ amountMax: 10 }).amountMin).toBeNull()
    expect(normalizeTagRuleCriteria({ amountMax: 10 }).amountMax).toBe(10)
  })
})

describe('isTagRuleCriteriaEmpty', () => {
  it('is true for untouched criteria and false once any condition is set', () => {
    expect(isTagRuleCriteriaEmpty(criteria())).toBe(true)
    expect(isTagRuleCriteriaEmpty(criteria({ description: 'x' }))).toBe(false)
    expect(isTagRuleCriteriaEmpty(criteria({ amountMin: 0 }))).toBe(false)
  })

  it('ignores the match mode, which is not a condition', () => {
    expect(isTagRuleCriteriaEmpty(criteria({ match: 'any' }))).toBe(true)
  })
})

describe('transactionMatchesTagRule', () => {
  it('never matches on empty criteria — a blank rule must not sweep the ledger', () => {
    expect(transactionMatchesTagRule(tx(), criteria())).toBe(false)
    expect(transactionMatchesTagRule(tx(), criteria({ match: 'any' }))).toBe(false)
  })

  it('matches text conditions in every mode', () => {
    expect(transactionMatchesTagRule(tx(), criteria({ description: 'cloud' }))).toBe(true)
    expect(transactionMatchesTagRule(tx(), criteria({ description: 'CLOUD' }))).toBe(true)
    expect(
      transactionMatchesTagRule(
        tx(),
        criteria({ description: 'AWS cloud hosting', descriptionMode: 'equals' })
      )
    ).toBe(true)
    expect(
      transactionMatchesTagRule(tx(), criteria({ description: 'AWS', descriptionMode: 'equals' }))
    ).toBe(false)
    expect(
      transactionMatchesTagRule(
        tx(),
        criteria({ description: 'aws', descriptionMode: 'starts_with' })
      )
    ).toBe(true)
    expect(
      transactionMatchesTagRule(
        tx(),
        criteria({ description: 'hosting', descriptionMode: 'ends_with' })
      )
    ).toBe(true)
  })

  it('matches a counterparty on either the beneficiary or the payor side', () => {
    expect(transactionMatchesTagRule(tx(), criteria({ counterparty: 'amazon' }))).toBe(true)
    expect(
      transactionMatchesTagRule(
        tx({ beneficiary: '', payor: 'Amazon Web Services' }),
        criteria({ counterparty: 'amazon' })
      )
    ).toBe(true)
    expect(
      transactionMatchesTagRule(
        tx({ beneficiary: '', payor: '' }),
        criteria({ counterparty: 'amazon' })
      )
    ).toBe(false)
  })

  it('matches an account on either the source or the transfer destination', () => {
    expect(transactionMatchesTagRule(tx(), criteria({ accountIds: [2] }))).toBe(true)
    expect(
      transactionMatchesTagRule(
        tx({ account_id: 9, transfer_account_id: 2 }),
        criteria({ accountIds: [2] })
      )
    ).toBe(true)
    expect(transactionMatchesTagRule(tx({ account_id: 9 }), criteria({ accountIds: [2] }))).toBe(
      false
    )
  })

  it('compares amounts on absolute value, inclusive of both bounds', () => {
    expect(transactionMatchesTagRule(tx(), criteria({ amountMin: 50, amountMax: 50 }))).toBe(true)
    expect(transactionMatchesTagRule(tx({ amount: -50 }), criteria({ amountMin: 40 }))).toBe(true)
    expect(transactionMatchesTagRule(tx(), criteria({ amountMin: 51 }))).toBe(false)
    expect(transactionMatchesTagRule(tx(), criteria({ amountMax: 49 }))).toBe(false)
  })

  it('compares dates inclusively and tolerates a time component', () => {
    expect(
      transactionMatchesTagRule(tx(), criteria({ dateFrom: '2026-03-15', dateTo: '2026-03-15' }))
    ).toBe(true)
    expect(
      transactionMatchesTagRule(
        tx({ date: '2026-03-15T09:30:00Z' }),
        criteria({ dateFrom: '2026-03-01' })
      )
    ).toBe(true)
    expect(transactionMatchesTagRule(tx(), criteria({ dateFrom: '2026-04-01' }))).toBe(false)
  })

  it('requires every populated condition under match: all', () => {
    const rule = criteria({ description: 'AWS', types: ['expense'], categoryIds: [7] })
    expect(transactionMatchesTagRule(tx(), rule)).toBe(true)
    expect(transactionMatchesTagRule(tx({ category_id: 8 }), rule)).toBe(false)
    expect(transactionMatchesTagRule(tx({ type: 'income' }), rule)).toBe(false)
  })

  it('requires only one populated condition under match: any', () => {
    const rule = criteria({ match: 'any', description: 'nope', categoryIds: [7] })
    expect(transactionMatchesTagRule(tx(), rule)).toBe(true)
    expect(transactionMatchesTagRule(tx({ category_id: 8 }), rule)).toBe(false)
  })

  it('treats a missing field as a non-match rather than a match', () => {
    expect(transactionMatchesTagRule({}, criteria({ description: 'aws' }))).toBe(false)
    expect(transactionMatchesTagRule({}, criteria({ categoryIds: [7] }))).toBe(false)
    expect(transactionMatchesTagRule({}, criteria({ amountMin: 1 }))).toBe(false)
    expect(transactionMatchesTagRule({}, criteria({ dateFrom: '2026-01-01' }))).toBe(false)
  })

  it('unions across several rules', () => {
    const rules = [criteria({ description: 'nope' }), criteria({ categoryIds: [7] })]
    expect(transactionMatchesAnyTagRule(tx(), rules)).toBe(true)
    expect(transactionMatchesAnyTagRule(tx({ category_id: 8 }), rules)).toBe(false)
    expect(transactionMatchesAnyTagRule(tx(), [])).toBe(false)
  })
})

describe('tagRuleScanNarrowing', () => {
  it('keeps only the structural conditions', () => {
    const narrowed = tagRuleScanNarrowing(
      criteria({
        description: 'aws',
        amountMin: 5,
        counterparty: 'amazon',
        types: ['expense'],
        categoryIds: [7],
        accountIds: [2],
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      })
    )
    expect(narrowed).not.toBeNull()
    // Structural conditions survive...
    expect(narrowed).toMatchObject({
      types: ['expense'],
      categoryIds: [7],
      accountIds: [2],
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    })
    // ...text and amount conditions are left to the full matcher.
    expect(narrowed!.description).toBe('')
    expect(narrowed!.counterparty).toBe('')
    expect(narrowed!.amountMin).toBeNull()
  })

  it('never narrows an OR rule — no single condition may shrink the candidate set', () => {
    expect(tagRuleScanNarrowing(criteria({ match: 'any', categoryIds: [7] }))).toBeNull()
  })

  it('returns null when only non-structural conditions are set', () => {
    expect(tagRuleScanNarrowing(criteria({ description: 'aws' }))).toBeNull()
    expect(tagRuleScanNarrowing(criteria({ amountMin: 5 }))).toBeNull()
    expect(tagRuleScanNarrowing(criteria())).toBeNull()
  })

  it('accepts every row the full rule would match — narrowing must never drop a match', () => {
    // The contract the scan pre-filter relies on: anything passing the full rule also passes the
    // narrowing, so pre-filtering can only shrink the scan, never change the result.
    const full = criteria({
      description: 'aws',
      types: ['expense'],
      categoryIds: [7],
      dateFrom: '2026-01-01',
    })
    const narrowed = tagRuleScanNarrowing(full)!
    for (const row of [tx(), tx({ category_id: 8 }), tx({ type: 'income' }), tx({ date: 'x' })]) {
      if (transactionMatchesTagRule(row, full)) {
        expect(transactionMatchesTagRule(row, narrowed)).toBe(true)
      }
    }
  })
})

describe('splitTagRuleConditions', () => {
  it('returns one entry per populated condition and none for the rest', () => {
    const parts = splitTagRuleConditions(
      criteria({ description: 'aws', categoryIds: [7], accountIds: [2] })
    )
    expect(parts.map((p) => p.key).sort()).toEqual(['accounts', 'categories', 'description'])
    expect(splitTagRuleConditions(criteria())).toEqual([])
  })

  it('isolates each condition so it can be evaluated alone', () => {
    const parts = splitTagRuleConditions(criteria({ description: 'aws', categoryIds: [7] }))
    const byKey = Object.fromEntries(parts.map((p) => [p.key, p.criteria]))
    // The description entry constrains description ONLY — category is left unset.
    expect(byKey.description.description).toBe('aws')
    expect(byKey.description.categoryIds).toEqual([])
    expect(byKey.categories.categoryIds).toEqual([7])
    expect(byKey.categories.description).toBe('')
  })

  it('explains the reported case: description matches, category is the blocker', () => {
    // The exact rule and row from the dev report — description "Feedbackqueue" on a transaction
    // filed under a different category than the rule required. The whole rule matches nothing,
    // and the per-condition split is what makes the reason visible.
    const row = {
      description: 'Feedbackqueue',
      beneficiary: 'Feedbackqueue',
      type: 'expense',
      amount: 8.2,
      date: '2026-07-20',
      category_id: 99,
      account_id: 4,
    }
    const rule = criteria({
      description: 'Feedbackqueue',
      categoryIds: [7],
      accountIds: [1, 4],
    })
    expect(transactionMatchesTagRule(row, rule)).toBe(false)

    const counts = Object.fromEntries(
      splitTagRuleConditions(rule).map((p) => [
        p.key,
        transactionMatchesTagRule(row, p.criteria) ? 1 : 0,
      ])
    )
    expect(counts).toEqual({ description: 1, accounts: 1, categories: 0 })
  })

  it('labels each condition readably', () => {
    const parts = splitTagRuleConditions(
      criteria({ description: 'aws', descriptionMode: 'starts_with', amountMin: 5 })
    )
    const labels = parts.map((p) => p.label)
    expect(labels).toContain('description starts with "aws"')
    expect(labels).toContain('amount ≥ 5')
  })

  it('agrees with the full rule: every condition passing means the rule passes', () => {
    const rule = criteria({ description: 'aws', types: ['expense'], categoryIds: [7] })
    const allPass = splitTagRuleConditions(rule).every((p) =>
      transactionMatchesTagRule(tx(), p.criteria)
    )
    expect(allPass).toBe(transactionMatchesTagRule(tx(), rule))
  })
})

describe('describeTagRuleCriteria', () => {
  it('says plainly that an empty rule matches nothing', () => {
    expect(describeTagRuleCriteria(criteria())).toBe('No conditions — matches nothing')
  })

  it('joins conditions with the active match mode', () => {
    const all = describeTagRuleCriteria(criteria({ description: 'AWS', types: ['expense'] }))
    expect(all).toContain(' AND ')
    const any = describeTagRuleCriteria(
      criteria({ match: 'any', description: 'AWS', types: ['expense'] })
    )
    expect(any).toContain(' OR ')
  })

  it('renders one-sided and two-sided bounds differently', () => {
    expect(describeTagRuleCriteria(criteria({ amountMin: 10 }))).toContain('≥ 10')
    expect(describeTagRuleCriteria(criteria({ amountMax: 10 }))).toContain('≤ 10')
    expect(describeTagRuleCriteria(criteria({ amountMin: 10, amountMax: 20 }))).toContain('10–20')
  })
})
