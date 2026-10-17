/**
 * The guidance answers record (shared/guidance/answers.ts): what this build reads in it, what a
 * write changes, and what `PUT /api/settings` refuses. A field this build does not know, or a value
 * it cannot read, is kept as it is: a newer build's answers survive a write from this one.
 */
import { describe, expect, it } from 'vitest'
import {
  ANSWERS_MAX_BYTES,
  ANSWERS_MESSAGES as M,
  answersRecord,
  checkAnswers,
  mergeAnswers,
  readAnswers,
} from '../../../../shared/guidance/answers'
import {
  belongsToOneProfile,
  splitLocalProfileSettingKey,
} from '../../../../shared/profileSettings'
import { checkSettingsUpdate } from '../../../../shared/settingsSchema'
import type { AnswerChanges } from '../../../../shared/guidance/answers'

/** A record from a newer build: two answers this one reads, and two questions it has never asked. */
const NEWER = JSON.stringify({
  region: 'HR',
  adults: 2,
  tenure: 'own_mortgage',
  support: { payees: ['Mum'], askedOn: '2026-11-02' },
})

describe('what this build reads in a stored record', () => {
  it('reads the region and the household', () => {
    expect(readAnswers('{"region":"DE","adults":2,"children":0}')).toEqual({
      region: 'DE',
      adults: 2,
      children: 0,
    })
    for (const region of ['DE', 'HR', 'EU27', 'UK', 'US', 'elsewhere', 'skipped']) {
      expect(readAnswers(JSON.stringify({ region }))).toEqual({ region })
    }
  })

  it('reads a value it cannot read as unanswered', () => {
    expect(readAnswers('{"region":"AT","adults":0,"children":1.5}')).toEqual({})
    expect(readAnswers('{"region":"de","adults":"2","children":-1}')).toEqual({})
  })

  it('reads no record, or one that is not an object, as no answers', () => {
    for (const stored of [undefined, null, '', 'not json', '[1,2]', '"DE"', '42', 7]) {
      expect(readAnswers(stored)).toEqual({})
      expect(answersRecord(stored)).toEqual({})
    }
  })

  it('reads a record local-first holds as an object as well as text', () => {
    expect(readAnswers({ region: 'UK', children: 3 })).toEqual({ region: 'UK', children: 3 })
  })
})

describe('a write to the record', () => {
  it('changes only the fields it answers, and keeps every other as stored', () => {
    expect(mergeAnswers(NEWER, { children: 1 })).toEqual({
      region: 'HR',
      adults: 2,
      children: 1,
      tenure: 'own_mortgage',
      support: { payees: ['Mum'], askedOn: '2026-11-02' },
    })
  })

  it('keeps a value this build cannot read unless it answers that field', () => {
    expect(mergeAnswers('{"region":"AT"}', { adults: 1 })).toEqual({ region: 'AT', adults: 1 })
    expect(mergeAnswers('{"region":"AT"}', { region: 'DE' })).toEqual({ region: 'DE' })
  })

  it('clears a field set to null, and leaves one set to undefined', () => {
    expect(mergeAnswers(NEWER, { region: null, adults: undefined })).toEqual({
      adults: 2,
      tenure: 'own_mortgage',
      support: { payees: ['Mum'], askedOn: '2026-11-02' },
    })
  })

  it('changes no field this build does not know', () => {
    const merged = mergeAnswers(NEWER, { region: 'US', tenure: 'rent' } as AnswerChanges)
    expect(merged.region).toBe('US')
    expect(merged.tenure).toBe('own_mortgage')
  })

  it('starts from an empty record when the stored one cannot be read', () => {
    expect(mergeAnswers('{broken', { region: 'skipped' })).toEqual({ region: 'skipped' })
  })
})

describe('what PUT /api/settings stores for the answers', () => {
  it('stores the text as sent, with the fields this build does not know', () => {
    expect(checkAnswers(NEWER)).toEqual({ ok: true, value: NEWER })
    expect(checkAnswers('{}')).toEqual({ ok: true, value: '{}' })
  })

  it('stores a region it does not know, as long as it is an id', () => {
    expect(checkAnswers('{"region":"AT"}').ok).toBe(true)
    expect(checkAnswers('{"region":"north_east-2"}').ok).toBe(true)
  })

  it('takes a field sent as null as unanswered', () => {
    expect(checkAnswers('{"region":null,"adults":null,"children":null}').ok).toBe(true)
  })

  it.each([
    ['an object rather than text', { region: 'DE' }, M.record],
    ['a number', 42, M.record],
    ['text that is not JSON', '{region: DE}', M.record],
    ['a list', '[{"region":"DE"}]', M.record],
    ['JSON null', 'null', M.record],
    ['a JSON string', '"DE"', M.record],
    ['a region that is a number', '{"region":49}', M.region],
    ['a region that is empty', '{"region":""}', M.region],
    ['a region with spaces', '{"region":"United Kingdom"}', M.region],
    ['a region of 33 characters', JSON.stringify({ region: 'x'.repeat(33) }), M.region],
    ['no adults', '{"adults":0}', M.adults],
    ['half an adult', '{"adults":1.5}', M.adults],
    ['adults as text', '{"adults":"2"}', M.adults],
    ['a hundred adults', '{"adults":100}', M.adults],
    ['fewer than no children', '{"children":-1}', M.children],
    ['children as text', '{"children":"none"}', M.children],
  ])('refuses %s', (_, raw, message) => {
    expect(checkAnswers(raw)).toEqual({ ok: false, error: message })
  })

  it('takes the counts the questions offer, and up to 99', () => {
    expect(checkAnswers('{"adults":1,"children":0}').ok).toBe(true)
    expect(checkAnswers('{"adults":99,"children":99}').ok).toBe(true)
  })

  it('stores at most 4 KB of text, counted in bytes', () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length
    /** A record of exactly `size` bytes, its note written in `letter`. */
    const sized = (size: number, letter: string) => {
      const shell = JSON.stringify({ note: '' }).length
      const text = JSON.stringify({ note: letter.repeat((size - shell) / bytes(letter)) })
      expect(bytes(text)).toBe(size)
      return text
    }
    expect(checkAnswers(sized(ANSWERS_MAX_BYTES, 'a')).ok).toBe(true)
    expect(checkAnswers(sized(ANSWERS_MAX_BYTES + 1, 'a'))).toEqual({ ok: false, error: M.size })
    // Two bytes a letter: 2,054 characters, 4,097 bytes.
    const wide = sized(ANSWERS_MAX_BYTES + 1, 'ž')
    expect(wide.length).toBe(2054)
    expect(checkAnswers(wide)).toEqual({ ok: false, error: M.size })
  })

  it('checks the answers under either key, and names the key in a refusal', () => {
    for (const key of ['guidance', 'guidance:3']) {
      expect(checkSettingsUpdate({ [key]: '{"region":"DE"}' })).toEqual({
        ok: true,
        value: { [key]: '{"region":"DE"}' },
      })
      expect(checkSettingsUpdate({ [key]: '{"adults":0}' })).toEqual({
        ok: false,
        fields: { [key]: M.adults },
      })
    }
    // Not a profile's key: an ordinary setting, stored as text.
    expect(checkSettingsUpdate({ 'guidance:me': 'x' })).toEqual({
      ok: true,
      value: { 'guidance:me': 'x' },
    })
  })
})

describe('the answers belong to one profile', () => {
  it("are kept under each profile's key in local-first", () => {
    expect(splitLocalProfileSettingKey('guidance:7')).toEqual({ key: 'guidance', profileId: 7 })
    expect(belongsToOneProfile('guidance')).toBe(true)
    expect(belongsToOneProfile('guidance:7')).toBe(true)
    expect(splitLocalProfileSettingKey('guidance:me')).toBeNull()
    expect(splitLocalProfileSettingKey('xguidance:7')).toBeNull()
  })
})
