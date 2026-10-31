/**
 * A rule set stored in this browser that equals an earlier version's built-in rules was never
 * edited. A mapping switch stored a full copy of the group's built-in rules (so did a save with
 * nothing changed), and that copy read as an edit: it kept giving that version's names after the
 * built-in rules moved on, so Transport, Fuel and Health came back for everyone who ever switched,
 * and switching the mapping warned that edits would be lost.
 *
 * The fixtures are the built-in rules as git has them at each version (DEFAULT_CATEGORY_RULES and
 * DEFAULT_CATEGORY_RULES_WORLDWIDE in shared/bankImport/categoryRules.ts), stored the way the app
 * stored them: JSON.stringify of the group's rules.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CATEGORY_RULES,
  DEFAULT_CATEGORY_RULES_WORLDWIDE,
  matchCategory,
  rulesForGroup,
} from '../../../../../shared/bankImport/categoryRules'
import { loadCategoryRules, saveCategoryRules, saveRuleGroup } from '../rulesStore'
import croatian671 from './fixtures/built-in-rules-croatian-671.json'
import croatian5173 from './fixtures/built-in-rules-croatian-v5.17.3.json'
import worldwide5173 from './fixtures/built-in-rules-worldwide-v5.17.3.json'
import type { CategoryRuleSet } from '../../../../../shared/bankImport/types'

const RULES_KEY = 'bankImportCategoryRules:1'
const GROUP_KEY = 'bankImportRuleGroup:1'

/** Store `rules` for profile 1 as the app did, with the mapping group if one was chosen. */
function stored(rules: unknown, group?: string): void {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules))
  if (group) localStorage.setItem(GROUP_KEY, group)
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
})

describe('a stored copy of an earlier version of the built-in rules', () => {
  it.each([
    ['Croatian, as 5.3.0 to 5.17.3 shipped it', croatian5173, 'croatian', DEFAULT_CATEGORY_RULES],
    ['Croatian, as main had it after #671', croatian671, 'croatian', DEFAULT_CATEGORY_RULES],
    [
      'Worldwide, as 5.3.5 to 5.17.3 shipped it',
      worldwide5173,
      'worldwide',
      DEFAULT_CATEGORY_RULES_WORLDWIDE,
    ],
  ])('loads as the rules its group has now: %s', (_version, copy, group, now) => {
    stored(copy, group)
    expect(loadCategoryRules()).toBe(now)
  })

  it('files parking, fares and the pharmacy under the defaults again', () => {
    stored(croatian5173, 'croatian')
    expect(matchCategory('PARKING TEST GARAGE 0000', loadCategoryRules())).toBe('Transportation')
    stored(worldwide5173, 'worldwide')
    expect(matchCategory('PHARMACY TEST 0000', loadCategoryRules())).toBe('Healthcare')
  })

  it('loads as the Croatian rules now when it was saved before any mapping was chosen', () => {
    stored(croatian5173)
    expect(loadCategoryRules()).toBe(DEFAULT_CATEGORY_RULES)
  })

  it('loads as the rules now of the group it is a copy of, whichever group is chosen', () => {
    stored(worldwide5173, 'croatian')
    expect(loadCategoryRules()).toBe(DEFAULT_CATEGORY_RULES_WORLDWIDE)
  })

  it('is an edit, and loads as stored, once a single keyword differs', () => {
    const edited = structuredClone(croatian5173) as CategoryRuleSet
    edited[0].keywords.push('test market')
    stored(edited, 'croatian')
    expect(loadCategoryRules()).toEqual(edited)
  })

  it('is an edit, and loads as stored, once a single category differs', () => {
    const edited = structuredClone(worldwide5173) as CategoryRuleSet
    edited[0].category = 'Test Category'
    stored(edited, 'worldwide')
    expect(loadCategoryRules()).toEqual(edited)
  })
})

describe('saving the built-in rules of a group as they are', () => {
  it.each(['croatian', 'worldwide'])(
    'stores no copy, so %s rules follow the built-in ones when a later version changes them',
    (group) => {
      saveRuleGroup(group)
      saveCategoryRules(structuredClone(rulesForGroup(group)))
      expect(localStorage.getItem(RULES_KEY)).toBeNull()
      expect(loadCategoryRules()).toBe(rulesForGroup(group))
    }
  )

  it('drops the edit stored before, when the rules are saved back to the built-in ones', () => {
    const custom = [{ category: 'Test Category', keywords: ['test shop'] }]
    saveCategoryRules(custom)
    expect(localStorage.getItem(RULES_KEY)).toBe(JSON.stringify(custom))
    saveCategoryRules(structuredClone(DEFAULT_CATEGORY_RULES))
    expect(localStorage.getItem(RULES_KEY)).toBeNull()
  })
})

describe('the earlier versions the app keeps', () => {
  it('are, for each group, the built-in rules as git has them', async () => {
    const { EARLIER_BUILT_IN_RULES } = await import('../earlierBuiltInRules')
    expect(EARLIER_BUILT_IN_RULES).toEqual({
      croatian: [croatian5173, croatian671],
      worldwide: [worldwide5173],
    })
  })
})
