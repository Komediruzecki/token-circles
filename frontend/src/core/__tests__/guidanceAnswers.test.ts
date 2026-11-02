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
  factsAnswersOf,
  FREE_MONEY_ANSWERS,
  mergeAnswers,
  readAnswers,
  TENURE_ANSWERS,
  withSupportCategoriesMoved,
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
  lastCircle: 4,
  support: { payees: ['Mum'], askedOn: '2026-11-02' },
})

/** Every answer the circles ask for, as a record holds them. */
const CIRCLES_ANSWERS = {
  supportCategoryIds: [12, 15],
  carriesCardBalance: false,
  freeMoney: { region: 'DE', answer: 'taken' },
  setsAsideYearly: true,
  savedElsewhere: { amount: 5000, currency: 'EUR' },
  enoughPerYear: { amount: 60000, currency: 'EUR' },
  tenure: 'mortgage',
  kindsAsked: true,
  savingsGoal: 15,
}

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

  it('reads every answer the circles ask for', () => {
    expect(readAnswers(JSON.stringify(CIRCLES_ANSWERS))).toEqual(CIRCLES_ANSWERS)
    for (const answer of FREE_MONEY_ANSWERS) {
      const freeMoney = { region: 'US', answer }
      expect(readAnswers({ freeMoney })).toEqual({ freeMoney })
    }
    for (const tenure of TENURE_ANSWERS) expect(readAnswers({ tenure })).toEqual({ tenure })
    expect(FREE_MONEY_ANSWERS).toEqual(['taken', 'partly', 'not-taken', 'not-offered', 'not-sure'])
    expect(TENURE_ANSWERS).toEqual([
      'rentPrivate',
      'rentSocial',
      'mortgage',
      'outright',
      'family',
      'skipped',
    ])
  })

  it('reads no to the money held elsewhere, a goal of 0, and an empty support list', () => {
    expect(
      readAnswers({
        savedElsewhere: { amount: 0, currency: 'GBP' },
        savingsGoal: 0,
        supportCategoryIds: [],
      })
    ).toEqual({
      savedElsewhere: { amount: 0, currency: 'GBP' },
      savingsGoal: 0,
      supportCategoryIds: [],
    })
    expect(readAnswers({ savingsGoal: 12.5 })).toEqual({ savingsGoal: 12.5 })
  })

  it.each([
    ['a tenure it does not know', { tenure: 'houseboat' }],
    ['a free money answer it does not know', { freeMoney: { region: 'DE', answer: 'maybe' } }],
    ['free money with no region', { freeMoney: { answer: 'taken' } }],
    ['free money as text', { freeMoney: 'taken' }],
    ['a card answer as text', { carriesCardBalance: 'yes' }],
    ['a yearly bills answer as a number', { setsAsideYearly: 1 }],
    ['the essentials answer as a number', { kindsAsked: 1 }],
    ['a support id of 0', { supportCategoryIds: [0] }],
    ['a support id with a fraction', { supportCategoryIds: [1.5] }],
    ['a support id as text', { supportCategoryIds: ['3'] }],
    ['savings elsewhere below 0', { savedElsewhere: { amount: -1, currency: 'EUR' } }],
    ['savings elsewhere with no currency', { savedElsewhere: { amount: 100 } }],
    ['a currency in lower case', { enoughPerYear: { amount: 100, currency: 'eur' } }],
    ['a year of more than enough at 0', { enoughPerYear: { amount: 0, currency: 'EUR' } }],
    ['a goal above 100', { savingsGoal: 101 }],
    ['a goal below 0', { savingsGoal: -5 }],
  ])('reads %s as unanswered', (_, record) => {
    expect(readAnswers(record)).toEqual({})
  })
})

describe('the support answer across a restore that gives categories new ids', () => {
  const moved = new Map([
    [12, 112],
    [15, 115],
  ])

  it('names the new ids, in the order answered, and leaves out one with no new id', () => {
    const stored = JSON.stringify({ region: 'DE', supportCategoryIds: [15, 9, 12], lastCircle: 4 })
    expect(JSON.parse(withSupportCategoriesMoved(stored, moved) as string)).toEqual({
      region: 'DE',
      supportCategoryIds: [115, 112],
      lastCircle: 4,
    })
    // A record local-first holds as an object comes back as one.
    expect(withSupportCategoriesMoved({ supportCategoryIds: [12] }, moved)).toEqual({
      supportCategoryIds: [112],
    })
  })

  it('gives back a record with no support list, or one it cannot read, as it was', () => {
    for (const stored of [NEWER, '{broken', '', null, '{"supportCategoryIds":"12"}']) {
      expect(withSupportCategoriesMoved(stored, moved)).toBe(stored)
    }
  })
})

describe('what the circles read of the answers', () => {
  const answers = readAnswers(JSON.stringify(CIRCLES_ANSWERS))

  it('reads free money only in the region it was asked for', () => {
    expect(factsAnswersOf(answers, { region: 'DE', currency: 'EUR' }).freeMoney).toBe('taken')
    expect(factsAnswersOf(answers, { region: 'HR', currency: 'EUR' }).freeMoney).toBeNull()
    expect(factsAnswersOf(answers, { region: 'EU27', currency: 'EUR' }).freeMoney).toBeNull()
  })

  it('reads the two amounts only in the currency they were given in', () => {
    expect(factsAnswersOf(answers, { region: 'DE', currency: 'EUR' })).toMatchObject({
      savedElsewhere: 5000,
      enoughPerYear: 60000,
    })
    expect(factsAnswersOf(answers, { region: 'DE', currency: 'GBP' })).toMatchObject({
      savedElsewhere: null,
      enoughPerYear: null,
    })
  })

  it('reads the support categories and the card answer wherever it is asked', () => {
    expect(factsAnswersOf(answers, { region: 'US', currency: 'USD' })).toEqual({
      supportCategoryIds: [12, 15],
      carriesCardBalance: false,
      freeMoney: null,
      savedElsewhere: null,
      enoughPerYear: null,
      setsAsideYearly: true,
    })
  })

  it('reads no answers as none answered', () => {
    expect(factsAnswersOf({}, { region: 'DE', currency: 'EUR' })).toEqual({
      supportCategoryIds: null,
      carriesCardBalance: null,
      freeMoney: null,
      savedElsewhere: null,
      enoughPerYear: null,
      setsAsideYearly: null,
    })
  })
})

describe('a write to the record', () => {
  it('changes only the fields it answers, and keeps every other as stored', () => {
    expect(mergeAnswers(NEWER, { children: 1 })).toEqual({
      region: 'HR',
      adults: 2,
      children: 1,
      lastCircle: 4,
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
      lastCircle: 4,
      support: { payees: ['Mum'], askedOn: '2026-11-02' },
    })
  })

  it('changes no field this build does not know', () => {
    const merged = mergeAnswers(NEWER, { region: 'US', lastCircle: 5 } as AnswerChanges)
    expect(merged.region).toBe('US')
    expect(merged.lastCircle).toBe(4)
  })

  it("sets and clears the circles' answers, keeping the rest", () => {
    const merged = mergeAnswers(NEWER, {
      freeMoney: { region: 'HR', answer: 'not-taken' },
      savedElsewhere: { amount: 0, currency: 'EUR' },
      supportCategoryIds: [3],
    })
    expect(merged).toEqual({
      region: 'HR',
      adults: 2,
      lastCircle: 4,
      support: { payees: ['Mum'], askedOn: '2026-11-02' },
      freeMoney: { region: 'HR', answer: 'not-taken' },
      savedElsewhere: { amount: 0, currency: 'EUR' },
      supportCategoryIds: [3],
    })
    expect(mergeAnswers(merged, { freeMoney: null, savingsGoal: 20 })).toEqual({
      region: 'HR',
      adults: 2,
      lastCircle: 4,
      support: { payees: ['Mum'], askedOn: '2026-11-02' },
      savedElsewhere: { amount: 0, currency: 'EUR' },
      supportCategoryIds: [3],
      savingsGoal: 20,
    })
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

  it.each([
    ['support ids as text', '{"supportCategoryIds":"12"}', M.supportCategoryIds],
    ['a support id of 0', '{"supportCategoryIds":[0]}', M.supportCategoryIds],
    ['a support id as text', '{"supportCategoryIds":["12"]}', M.supportCategoryIds],
    [
      '101 support categories',
      JSON.stringify({ supportCategoryIds: Array.from({ length: 101 }, (_, i) => i + 1) }),
      M.supportCategoryIds,
    ],
    ['a card answer as text', '{"carriesCardBalance":"no"}', M.carriesCardBalance],
    ['free money as text', '{"freeMoney":"taken"}', M.freeMoney],
    ['free money with no region', '{"freeMoney":{"answer":"taken"}}', M.freeMoney],
    ['free money with no answer', '{"freeMoney":{"region":"DE"}}', M.freeMoney],
    [
      'free money with an answer in words',
      '{"freeMoney":{"region":"DE","answer":"I use it"}}',
      M.freeMoney,
    ],
    ['a yearly bills answer as a number', '{"setsAsideYearly":0}', M.setsAsideYearly],
    ['savings elsewhere as a number', '{"savedElsewhere":5000}', M.savedElsewhere],
    [
      'savings elsewhere below 0',
      '{"savedElsewhere":{"amount":-1,"currency":"EUR"}}',
      M.savedElsewhere,
    ],
    ['savings elsewhere with no currency', '{"savedElsewhere":{"amount":5}}', M.savedElsewhere],
    [
      'savings elsewhere as text',
      '{"savedElsewhere":{"amount":"5","currency":"EUR"}}',
      M.savedElsewhere,
    ],
    [
      'savings elsewhere of a trillion',
      '{"savedElsewhere":{"amount":1000000000000,"currency":"EUR"}}',
      M.savedElsewhere,
    ],
    [
      'a year of more than enough at 0',
      '{"enoughPerYear":{"amount":0,"currency":"EUR"}}',
      M.enoughPerYear,
    ],
    [
      'a currency that is not a code',
      '{"enoughPerYear":{"amount":9,"currency":"euro"}}',
      M.enoughPerYear,
    ],
    ['a tenure that is a number', '{"tenure":2}', M.tenure],
    ['a tenure with spaces', '{"tenure":"own outright"}', M.tenure],
    ['the essentials answer as text', '{"kindsAsked":"yes"}', M.kindsAsked],
    ['a goal above 100', '{"savingsGoal":120}', M.savingsGoal],
    ['a goal as text', '{"savingsGoal":"20"}', M.savingsGoal],
  ])('refuses %s', (_, raw, message) => {
    expect(checkAnswers(raw)).toEqual({ ok: false, error: message })
  })

  it("stores every answer the circles ask for, and the shapes a newer build's values take", () => {
    expect(checkAnswers(JSON.stringify(CIRCLES_ANSWERS)).ok).toBe(true)
    // A tenure and a free money answer it cannot read are ids, so a newer build's are stored.
    expect(checkAnswers('{"tenure":"houseboat"}').ok).toBe(true)
    expect(checkAnswers('{"freeMoney":{"region":"AT","answer":"salary_sacrifice"}}').ok).toBe(true)
    expect(checkAnswers('{"savedElsewhere":{"amount":0,"currency":"EUR"}}').ok).toBe(true)
    expect(checkAnswers('{"savingsGoal":0}').ok).toBe(true)
    expect(checkAnswers('{"savingsGoal":100}').ok).toBe(true)
    expect(
      checkAnswers(
        JSON.stringify({ supportCategoryIds: Array.from({ length: 100 }, (_, i) => i + 1) })
      ).ok
    ).toBe(true)
    const cleared = Object.fromEntries(Object.keys(CIRCLES_ANSWERS).map((field) => [field, null]))
    expect(checkAnswers(JSON.stringify(cleared)).ok).toBe(true)
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
