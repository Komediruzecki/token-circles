import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CATEGORY_RULES,
  DEFAULT_CATEGORY_RULES_WORLDWIDE,
  DEFAULT_RULE_GROUP_ID,
  matchCategory,
  RULE_GROUPS,
  rulesForGroup,
} from '../categoryRules'
import { loadCategoryRules, loadRuleGroup, saveCategoryRules, saveRuleGroup } from '../rulesStore'

describe('category rule groups', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('maps each group id to its rule set', () => {
    // Reference equality: the group holds the actual default array, not a copy.
    expect(rulesForGroup('croatian')).toBe(DEFAULT_CATEGORY_RULES)
    expect(rulesForGroup('worldwide')).toBe(DEFAULT_CATEGORY_RULES_WORLDWIDE)
  })

  it('falls back to the Croatian default for unknown / empty ids', () => {
    expect(rulesForGroup(null)).toBe(DEFAULT_CATEGORY_RULES)
    expect(rulesForGroup(undefined)).toBe(DEFAULT_CATEGORY_RULES)
    expect(rulesForGroup('bogus')).toBe(DEFAULT_CATEGORY_RULES)
  })

  it('exposes exactly the Croatian + Worldwide groups, Croatian as default', () => {
    expect(RULE_GROUPS.map((g) => g.id)).toEqual(['croatian', 'worldwide'])
    expect(DEFAULT_RULE_GROUP_ID).toBe('croatian')
  })

  it('loadRuleGroup defaults to croatian and round-trips saveRuleGroup', () => {
    expect(loadRuleGroup()).toBe('croatian')
    saveRuleGroup('worldwide')
    expect(loadRuleGroup()).toBe('worldwide')
  })

  // The invariant that protects EXISTING users: with no saved override and the
  // default group, the effective rules must still be the original Croatian seed —
  // no silent recategorization when the group feature shipped.
  it('existing users (no override, default group) keep the Croatian rules', () => {
    expect(loadCategoryRules()).toBe(DEFAULT_CATEGORY_RULES)
  })

  it('selecting Worldwide (no override) yields the worldwide seed', () => {
    saveRuleGroup('worldwide')
    expect(loadCategoryRules()).toBe(DEFAULT_CATEGORY_RULES_WORLDWIDE)
  })

  it('a saved override wins over the selected group', () => {
    const custom = [{ category: 'Custom', keywords: ['acme'] }]
    saveRuleGroup('worldwide')
    saveCategoryRules(custom)
    expect(loadCategoryRules()).toEqual(custom)
  })
})

describe('worldwide category matching', () => {
  it('honors longest-keyword-wins across categories', () => {
    const w = DEFAULT_CATEGORY_RULES_WORLDWIDE
    expect(matchCategory('AMAZON PRIME MEMBERSHIP', w)).toBe('Subscriptions')
    expect(matchCategory('amazon marketplace', w)).toBe('Shopping')
    expect(matchCategory('UBER EATS', w)).toBe('Dining')
    expect(matchCategory('uber trip 123', w)).toBe('Transport')
  })

  // Regression guard: a bare "rent" keyword substring-matched "current" — a very
  // common bank word ("Current Account") — mis-tagging it Housing. Keep it gone.
  it('does not mis-tag "current" as Housing, but still catches rent', () => {
    const w = DEFAULT_CATEGORY_RULES_WORLDWIDE
    expect(matchCategory('CURRENT ACCOUNT TRANSFER', w)).not.toBe('Housing')
    expect(matchCategory('monthly rent payment', w)).toBe('Housing')
  })
})
