/**
 * Resolution of whatever the user types into a category's Icon field.
 *
 * Unlike CategoryIcon.test.ts — which re-declares the pattern table locally to test the
 * matching rules in isolation — this imports the REAL function, because the thing under
 * test is the lookup chain itself (exact key, then keyword match, then nothing).
 *
 * The field used to be capped at `maxlength="2"` while its placeholder said
 * "e.g., food, home, car", so no suggested value could actually be typed. It now takes a
 * word, which means the lookup has to cope with arbitrary user text.
 */
import { describe, expect, it } from 'vitest'
import { getCategorySvg, iconFromUserValue, iconSvgByKey } from '../CategoryIcon'

describe('iconFromUserValue', () => {
  it('resolves an exact icon key', () => {
    expect(iconFromUserValue('utensils')).not.toBeNull()
    expect(iconFromUserValue('home')).not.toBeNull()
    expect(iconFromUserValue('briefcase')).not.toBeNull()
  })

  it('resolves the keywords the placeholder advertises', () => {
    // "food" and "car" are not icon keys — they only resolve through keyword matching,
    // which is exactly what the placeholder promises.
    for (const word of ['food', 'home', 'car']) {
      expect(iconFromUserValue(word), `"${word}" should resolve`).not.toBeNull()
    }
  })

  it('resolves a keyword to a real glyph, and different subjects to different glyphs', () => {
    // Keyword matching picks the family's icon, which is not necessarily the icon key you
    // would guess ("food" lands on the dining glyph, not literally `utensils`) — what
    // matters is that it is a real path and that distinct subjects stay distinguishable.
    const food = iconFromUserValue('food')
    const car = iconFromUserValue('car')
    const home = iconFromUserValue('home')
    for (const [word, def] of [
      ['food', food],
      ['car', car],
      ['home', home],
    ] as const) {
      expect(typeof def?.path, `"${word}" resolves to a path`).toBe('string')
      expect(def!.path.length, `"${word}" path is non-trivial`).toBeGreaterThan(10)
    }
    expect(food).not.toEqual(car)
    expect(car).not.toEqual(home)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(iconFromUserValue('  HOME  ')).toEqual(iconFromUserValue('home'))
    expect(iconFromUserValue('Food')).toEqual(iconFromUserValue('food'))
  })

  it('returns null for empty or unmatched input so the category name can decide', () => {
    expect(iconFromUserValue('')).toBeNull()
    expect(iconFromUserValue('   ')).toBeNull()
    expect(iconFromUserValue('zzzzqqqq')).toBeNull()
  })

  it('does not resolve inherited Object members to a bogus icon', () => {
    // A wider input box makes `constructor` / `toString` typeable; a plain index lookup
    // would return a function here and render <path d={undefined}>.
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const def = iconFromUserValue(key)
      if (def !== null)
        expect(typeof def.path, `"${key}" must resolve to a real path`).toBe('string')
    }
  })
})

describe('a category named like a default', () => {
  /** The path the category's icon draws. */
  const drawn = (name: string, icon?: string | null) =>
    (getCategorySvg(name, 18, icon) as unknown as SVGElement)
      .querySelector('path')!
      .getAttribute('d')
  const key = (icon: string) =>
    (iconSvgByKey(icon) as unknown as SVGElement).querySelector('path')!.getAttribute('d')

  it('draws Groceries as a cart and Eating out as utensils, without an icon of its own', () => {
    for (const icon of [undefined, null, '', 'tag', 'folder']) {
      expect(drawn('Groceries', icon), String(icon)).toBe(key('shopping-cart'))
      expect(drawn('Eating out', icon), String(icon)).toBe(key('utensils'))
    }
    expect(drawn('groceries')).toBe(key('shopping-cart'))
    expect(drawn('Eating Out')).toBe(key('utensils'))
  })

  it('keeps an icon the person chose', () => {
    expect(drawn('Groceries', 'home')).toBe(key('home'))
    expect(drawn('Eating out', 'coffee')).toBe(key('coffee'))
  })

  it('draws a meal as utensils, and coffee as the mug', () => {
    for (const name of [
      'Restaurant',
      'Restaurants',
      'Dining',
      'Meals',
      'Lunch',
      'Dinner',
      'Breakfast',
      'Eating',
      'Eat',
      'Work lunches',
    ])
      expect(drawn(name), name).toBe(key('utensils'))
    for (const name of ['Coffee', 'Cafe', 'Food']) expect(drawn(name), name).toBe(drawn('Coffee'))
    expect(drawn('Coffee')).not.toBe(key('utensils'))
    // "eat" and "eating" only as words.
    expect(drawn('Heating')).not.toBe(key('utensils'))
    expect(drawn('Seat covers')).not.toBe(key('utensils'))
    // A chosen icon still wins.
    expect(drawn('Restaurant', 'coffee')).toBe(key('coffee'))
  })
})
