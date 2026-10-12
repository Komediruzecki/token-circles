/**
 * Category kinds (shared/guidance/kinds.ts): the fifteen ids, the eight essential ones, the guess
 * a name gives, the kind a category goes by, and whether it is needed every month.
 */
import { describe, expect, it } from 'vitest'
import { resetKeepsIcon, resetName } from '../../../../shared/defaultCategories'
import {
  categoryLookup,
  effectiveKind,
  ESSENTIAL_KINDS,
  essentialOf,
  isEssential,
  KIND_LABELS,
  kindForName,
  kindIsEssential,
  KINDS,
  readKind,
} from '../../../../shared/guidance/kinds'
import { DEFAULT_CATEGORIES } from '../storage/idb'

describe('the kinds', () => {
  it('are the fifteen of the research, each with words a form shows', () => {
    expect(KINDS).toEqual([
      'housing',
      'utilities',
      'groceries',
      'eating_out',
      'transport',
      'health',
      'insurance',
      'childcare',
      'debt',
      'subscriptions',
      'shopping',
      'leisure',
      'gifts',
      'taxes',
      'other',
    ])
    for (const kind of KINDS) expect(KIND_LABELS[kind]).toMatch(/^[A-Z]/)
  })

  it('count eight as essential, and a category with no kind as essential too', () => {
    expect([...ESSENTIAL_KINDS].sort()).toEqual(
      [
        'childcare',
        'debt',
        'groceries',
        'health',
        'housing',
        'insurance',
        'transport',
        'utilities',
      ].sort()
    )
    expect(kindIsEssential('eating_out')).toBe(false)
    expect(kindIsEssential('groceries')).toBe(true)
    expect(kindIsEssential(null)).toBe(true)
  })

  it('are read in any case, around any space, and nothing else is one', () => {
    expect(readKind(' Eating_Out ')).toBe('eating_out')
    expect(readKind('pets')).toBeNull()
    expect(readKind(3)).toBeNull()
    expect(readKind(null)).toBeNull()
  })
})

describe('kindForName', () => {
  it.each([
    // The defaults, and the Food they used to have.
    ['Housing', 'housing'],
    ['Groceries', 'groceries'],
    ['Eating out', 'eating_out'],
    ['Transportation', 'transport'],
    ['Utilities', 'utilities'],
    ['Healthcare', 'health'],
    ['Entertainment', 'leisure'],
    ['Insurance', 'insurance'],
    ['Shopping', 'shopping'],
    ['Education', 'childcare'],
    ['Subscriptions', 'subscriptions'],
    ['Food', 'groceries'],
    // The names the bank import's rules file entries under.
    ['Restaurant', 'eating_out'],
    ['Dining', 'eating_out'],
    ['Transport', 'transport'],
    ['Fuel', 'transport'],
    ['Car (Gas)', 'transport'],
    ['Health', 'health'],
    ['Travel', 'leisure'],
    ['Apartment (Bills)', 'utilities'],
    ['Bank Fees', 'taxes'],
    // Words in a name of the person's own.
    ['  fast   FOOD ', 'eating_out'],
    ['Café', 'eating_out'],
    ['Weekly groceries', 'groceries'],
    ['Home internet', 'utilities'],
    ['Rent', 'housing'],
    ['Car insurance', 'insurance'],
    ['Car loan', 'transport'],
    ['Student loan', 'debt'],
    ['Kids', 'childcare'],
    ['Gym', 'leisure'],
    ['Christmas presents', 'gifts'],
    ['Misc', 'other'],
  ])('reads %s as %s', (name, kind) => {
    expect(kindForName(name)).toBe(kind)
  })

  it.each([['Transfers'], ['Pets'], [''], ['   '], ['Rentals bonus']])(
    'has no kind for %j',
    (name) => {
      // "Rentals" is not "rent": words count whole.
      expect(kindForName(name)).toBeNull()
    }
  )

  it('has no kind for something that is not a name', () => {
    expect(kindForName(undefined)).toBeNull()
    expect(kindForName(42)).toBeNull()
  })
})

describe('the kind a category goes by', () => {
  const food = { id: 1, name: 'Food', type: 'expense', kind: null, parent_id: null }
  const rent = { id: 2, name: 'Housing', type: 'expense', kind: 'utilities', parent_id: null }
  const lookup = categoryLookup([food, rent])

  it('is its own kind first', () => {
    expect(
      effectiveKind({ name: 'Restaurant', type: 'expense', kind: 'other', parent_id: 2 }, lookup)
    ).toBe('other')
  })

  it("is its parent's kind next, before what its own name suggests", () => {
    expect(effectiveKind({ name: 'Restaurant', type: 'expense', parent_id: 2 }, lookup)).toBe(
      'utilities'
    )
  })

  it("is what its own name suggests, then what its parent's name suggests", () => {
    expect(effectiveKind({ name: 'Restaurant', type: 'expense', parent_id: 1 }, lookup)).toBe(
      'eating_out'
    )
    expect(effectiveKind({ name: 'Bakery', type: 'expense', parent_id: 1 }, lookup)).toBe(
      'groceries'
    )
  })

  it('is none for a category that takes no kind', () => {
    expect(effectiveKind({ name: 'Groceries', type: 'income', kind: 'groceries' })).toBeNull()
  })

  it('ignores a stored kind this build does not have', () => {
    expect(effectiveKind({ name: 'Rent', type: 'expense', kind: 'pets' })).toBe('housing')
  })
})

describe('whether a category is needed every month', () => {
  it('is what the person chose, whatever the kind says', () => {
    expect(essentialOf({ name: 'Rent', type: 'expense', essential: 0 })).toEqual({
      essential: false,
      kind: 'housing',
      via: 'chosen',
    })
    expect(isEssential({ name: 'Cinema', type: 'expense', kind: 'leisure', essential: true })).toBe(
      true
    )
  })

  it('is what the kind says while nothing is chosen', () => {
    expect(essentialOf({ name: 'Restaurant', type: 'expense', essential: null })).toEqual({
      essential: false,
      kind: 'eating_out',
      via: 'kind',
    })
  })

  it('is yes for a category with no kind at all, counted as such', () => {
    expect(essentialOf({ name: 'Pets', type: 'expense' })).toEqual({
      essential: true,
      kind: null,
      via: 'no-kind',
    })
  })
})

describe('the local-first defaults', () => {
  it('give each expense category the kind its name suggests, and income ones none', () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.kind, category.name).toBe(
        category.type === 'expense' ? kindForName(category.name) : null
      )
    }
  })

  it('have Groceries and Eating out, and no Food', () => {
    const names = DEFAULT_CATEGORIES.map((category) => category.name)
    expect(names).toContain('Groceries')
    expect(names).toContain('Eating out')
    expect(names).not.toContain('Food')
  })

  it('take Food back to Groceries on a reset', () => {
    expect(resetName(' FOOD ')).toBe('groceries')
    expect(resetName('Housing')).toBe('housing')
  })

  it("give Groceries and Eating out the Worker's icons", () => {
    const icon = (name: string) => DEFAULT_CATEGORIES.find((c) => c.name === name)?.icon
    expect(icon('Groceries')).toBe('shopping-cart')
    expect(icon('Eating out')).toBe('utensils')
  })
})

describe('the icon a reset gives Food as it becomes Groceries', () => {
  it('keeps an icon the person chose, and replaces one nobody chose', () => {
    expect(resetKeepsIcon('Food', 'coffee')).toBe(true)
    expect(resetKeepsIcon(' food ', 'home')).toBe(true)
    // The old default's own icon, and the values stored when nobody chose one.
    for (const icon of ['utensils', 'tag', 'folder', '', ' ', null, undefined])
      expect(resetKeepsIcon('Food', icon), String(icon)).toBe(false)
    // A default matched by its own name is set back to the default, icon and all.
    expect(resetKeepsIcon('Groceries', 'coffee')).toBe(false)
    expect(resetKeepsIcon('Housing', 'coffee')).toBe(false)
  })
})
