/**
 * The tag rules both runtimes run (shared/tagSchema.ts). The route and handler tests prove each
 * runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import { CONSTELLATION } from '../../../../shared/palette'
import { refusalOf } from '../../../../shared/refusal'
import {
  checkTagCreate,
  checkTagEdit,
  clashingTagName,
  defaultTagColor,
  readTagIds,
  renamesTag,
  sameTagName,
  TAG_MESSAGES,
  TAG_NAME_MAX,
  tagNameTaken,
} from '../../../../shared/tagSchema'
import { CATEGORY_PALETTE } from '../brandPalette'

const NEXT = '#e0708a'

describe('a new tag', () => {
  it('is its name, trimmed, and its colour, and nothing else', () => {
    expect(checkTagCreate({ name: '  Trip ', color: '#22AA66', id: 9 }, NEXT)).toEqual({
      ok: true,
      value: { name: 'Trip', color: '#22AA66' },
    })
  })

  it('needs a name', () => {
    for (const body of [
      {},
      { name: '' },
      { name: '   ' },
      { name: null },
      { name: 42 },
      null,
      [],
    ]) {
      expect(checkTagCreate(body, NEXT)).toEqual({
        ok: false,
        fields: { name: 'Give the tag a name.' },
      })
    }
  })

  it('takes a name of up to 50 characters, and refuses a longer one', () => {
    expect(TAG_NAME_MAX).toBe(50)
    expect(checkTagCreate({ name: 'x'.repeat(50) }, NEXT).ok).toBe(true)
    expect(checkTagCreate({ name: ` ${'x'.repeat(50)} ` }, NEXT).ok).toBe(true)
    expect(checkTagCreate({ name: 'x'.repeat(51) }, NEXT)).toEqual({
      ok: false,
      fields: { name: 'Keep the name to 50 characters or fewer.' },
    })
  })

  it('takes a colour as #RRGGBB, and refuses any other', () => {
    for (const color of ['red', '#abc', '#12345g', '123456', '#1234567', 7, true]) {
      expect(checkTagCreate({ name: 'Trip', color }, NEXT)).toEqual({
        ok: false,
        fields: { color: "That color can't be used. Pick another one." },
      })
    }
    expect(checkTagCreate({ name: 'Trip', color: ' #a1B2c3 ' }, NEXT)).toEqual({
      ok: true,
      value: { name: 'Trip', color: '#a1B2c3' },
    })
  })

  it('takes the colour it is given when sent without one', () => {
    for (const color of [undefined, null, '', '  ']) {
      expect(checkTagCreate({ name: 'Trip', color }, NEXT)).toEqual({
        ok: true,
        value: { name: 'Trip', color: NEXT },
      })
    }
  })

  it('names every field that is wrong at once', () => {
    expect(checkTagCreate({ name: '', color: 'red' }, NEXT)).toEqual({
      ok: false,
      fields: { name: TAG_MESSAGES.name, color: TAG_MESSAGES.color },
    })
  })

  it('answers the refusal both runtimes send', () => {
    const checked = checkTagCreate({ name: ' ' }, NEXT)
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(refusalOf(checked.fields)).toEqual({
      error: 'Give the tag a name.',
      fields: { name: 'Give the tag a name.' },
    })
  })
})

describe('the colour of a tag sent without one', () => {
  it("is the next of the app's palette, by how many tags the profile has", () => {
    expect(defaultTagColor(0)).toBe(CONSTELLATION[0])
    expect(defaultTagColor(3)).toBe(CONSTELLATION[3])
    expect(defaultTagColor(CONSTELLATION.length)).toBe(CONSTELLATION[0])
    expect(defaultTagColor(CONSTELLATION.length + 2)).toBe(CONSTELLATION[2])
  })

  it('is the first for a count that is not one', () => {
    for (const count of [-1, 1.5, Number.NaN]) expect(defaultTagColor(count)).toBe(CONSTELLATION[0])
  })

  it('is the palette the Tags page draws its swatches from', () => {
    expect(CATEGORY_PALETTE).toBe(CONSTELLATION)
    expect(defaultTagColor(0)).toBe('#6e9bff')
  })
})

describe('an edit', () => {
  const stored = { name: 'Trip', color: '#22aa66' }

  it('changes only what it changes', () => {
    expect(checkTagEdit({ name: ' Holiday ', color: '#225588' }, stored)).toEqual({
      ok: true,
      value: { name: 'Holiday', color: '#225588' },
    })
    expect(checkTagEdit({ name: 'Holiday' }, stored)).toEqual({
      ok: true,
      value: { name: 'Holiday' },
    })
    expect(checkTagEdit({ color: '#225588' }, stored)).toEqual({
      ok: true,
      value: { color: '#225588' },
    })
  })

  it('keeps the colour when it is left out or blank', () => {
    for (const color of [undefined, null, '', ' ']) {
      expect(checkTagEdit({ name: 'Holiday', color }, stored)).toEqual({
        ok: true,
        value: { name: 'Holiday' },
      })
    }
  })

  it('writes nothing it is sent back unchanged, in another case or with space around it', () => {
    expect(checkTagEdit({ name: ' Trip ', color: '#22AA66' }, stored)).toEqual({
      ok: true,
      value: {},
    })
  })

  it('checks a new name and a new colour like a new tag', () => {
    expect(checkTagEdit({ name: '' }, stored)).toEqual({
      ok: false,
      fields: { name: TAG_MESSAGES.name },
    })
    expect(checkTagEdit({ name: 'x'.repeat(51) }, stored)).toEqual({
      ok: false,
      fields: { name: TAG_MESSAGES.nameLength },
    })
    expect(checkTagEdit({ color: 'blue' }, stored)).toEqual({
      ok: false,
      fields: { color: TAG_MESSAGES.color },
    })
  })

  it('takes back what an older version stored', () => {
    const older = { name: 'y'.repeat(60), color: 'red' }
    expect(checkTagEdit({ name: 'y'.repeat(60), color: 'red' }, older)).toEqual({
      ok: true,
      value: {},
    })
    expect(checkTagEdit({ name: 'y'.repeat(60), color: '#225588' }, older)).toEqual({
      ok: true,
      value: { color: '#225588' },
    })
    expect(checkTagEdit({ name: 'Short', color: 'red' }, older)).toEqual({
      ok: true,
      value: { name: 'Short' },
    })
  })

  it('lets a long older name change case without a length check', () => {
    const older = { name: 'y'.repeat(60), color: '#22aa66' }
    expect(checkTagEdit({ name: 'Y'.repeat(60) }, older)).toEqual({
      ok: true,
      value: { name: 'Y'.repeat(60) },
    })
  })
})

describe('a name taken by another tag', () => {
  const existing = [
    { id: 1, name: 'Trip' },
    { id: 2, name: 'Work' },
  ]

  it('is the same name without case or the space around it', () => {
    expect(sameTagName(' trip', 'TRIP ')).toBe(true)
    expect(sameTagName('Trip', 'Trips')).toBe(false)
    expect(clashingTagName(existing, ' trip ')).toBe('Trip')
    expect(clashingTagName(existing, 'Home')).toBeNull()
  })

  it('leaves out the tag being renamed', () => {
    expect(clashingTagName(existing, 'TRIP', 1)).toBeNull()
    expect(clashingTagName(existing, 'work', 1)).toBe('Work')
  })

  it('clashes only exactly when a rename only changes the case', () => {
    expect(renamesTag('Trip', 'TRIP')).toBe(false)
    expect(renamesTag('Trip', 'Travel')).toBe(true)
    expect(renamesTag(undefined, 'Trip')).toBe(true)
    expect(clashingTagName([{ id: 3, name: 'trip' }], 'TRIP', 1, true)).toBeNull()
    expect(clashingTagName([{ id: 3, name: 'TRIP' }], 'TRIP', 1, true)).toBe('TRIP')
  })

  it('is refused in words that quote the other tag', () => {
    expect(tagNameTaken(' Trip ')).toEqual({
      name: 'You already have a tag called "Trip". Choose another name.',
    })
  })
})

describe("a transaction's tags", () => {
  it('are a list of ids, each read once, in order', () => {
    expect(readTagIds([3, '5', 3, 1])).toEqual({ ok: true, value: [3, 5, 1] })
    expect(readTagIds([])).toEqual({ ok: true, value: [] })
  })

  it('refuse anything else at tagIds', () => {
    for (const raw of [
      undefined,
      null,
      '3',
      3,
      { 0: 3 },
      [0],
      [-2],
      [1.5],
      ['x'],
      [null],
      [true],
    ]) {
      expect(readTagIds(raw)).toEqual({
        ok: false,
        fields: { tagIds: "Choose tags from this profile's list." },
      })
    }
  })
})
