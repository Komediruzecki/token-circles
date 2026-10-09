/**
 * shared/categoryMappingSchema.ts and shared/autoCategorize.ts: what a mapping, an apply-mappings
 * body and an auto-map body may hold, and what auto-map suggests, in both runtimes. Every rule and
 * every message.
 */
import { describe, expect, it } from 'vitest'
import { MERCHANT_DICTIONARY, suggestCategory } from '../../../../shared/autoCategorize'
import {
  autoMapDescription,
  autoMapsByDescription,
  CATEGORY_MAPPING_MESSAGES as M,
  checkApplyMappings,
  checkAutoMap,
  checkCategoryMapping,
  DEFAULT_MAPPING_CONFIDENCE,
  foreignMappingCategory,
  learnedPattern,
} from '../../../../shared/categoryMappingSchema'
import type { LearnedMapping, MatchCategory } from '../../../../shared/autoCategorize'

const fieldsOf = (checked: { ok: boolean; fields?: Record<string, string> }) =>
  checked.ok ? null : checked.fields

describe('the words', () => {
  it('say how to put each field right', () => {
    expect(M).toEqual({
      pattern: 'Give the text to match, like "netflix".',
      category: 'Choose a category from the list.',
      confidence: 'Use a confidence above 0 and up to 1, like 0.9.',
      mappings:
        'Send the transactions to file as a list, like [{"transaction_id": 12, "category_id": 3}].',
      transaction: 'Name the transaction by its id, like 12.',
      patternText: 'Send the pattern as text, like "netflix", or leave it out.',
      transactionIds: 'Send the transactions as a list of ids, like [12, 13], or leave it out.',
      description: 'Send the description as text, or leave it out.',
    })
  })
})

describe('a mapping saved', () => {
  it('keeps its pattern trimmed, and is 0.9 sure when the body does not say', () => {
    expect(DEFAULT_MAPPING_CONFIDENCE).toBeCloseTo(0.9, 10)
    expect(checkCategoryMapping({ pattern: '  Netflix ', category_id: 4 })).toEqual({
      ok: true,
      value: { pattern: 'Netflix', category_id: 4, confidence: 0.9 },
    })
    expect(checkCategoryMapping({ pattern: 'x', category_id: 4, confidence: null })).toMatchObject({
      value: { confidence: 0.9 },
    })
  })

  it('reads an id and a confidence sent as text', () => {
    expect(checkCategoryMapping({ pattern: 'x', category_id: '4', confidence: '0.75' })).toEqual({
      ok: true,
      value: { pattern: 'x', category_id: 4, confidence: 0.75 },
    })
  })

  it('takes a confidence of exactly 1', () => {
    expect(checkCategoryMapping({ pattern: 'x', category_id: 4, confidence: 1 })).toMatchObject({
      ok: true,
      value: { confidence: 1 },
    })
  })

  it('needs a pattern with something in it', () => {
    for (const pattern of [undefined, null, '', '   ', 12, ['x']]) {
      expect(fieldsOf(checkCategoryMapping({ pattern, category_id: 4 }))).toEqual({
        pattern: M.pattern,
      })
    }
  })

  it('needs a category, by its id', () => {
    for (const category_id of [undefined, null, '', 0, -1, 1.5, 'x', {}]) {
      expect(fieldsOf(checkCategoryMapping({ pattern: 'x', category_id }))).toEqual({
        category_id: M.category,
      })
    }
  })

  it('needs a confidence above 0 and up to 1', () => {
    for (const confidence of [0, -0.1, 1.01, 'sure', Number.NaN, {}]) {
      expect(fieldsOf(checkCategoryMapping({ pattern: 'x', category_id: 4, confidence }))).toEqual({
        confidence: M.confidence,
      })
    }
  })

  it('says everything that is wrong at once, and takes a body that is not an object as empty', () => {
    expect(fieldsOf(checkCategoryMapping('netflix'))).toEqual({
      pattern: M.pattern,
      category_id: M.category,
    })
  })
})

describe('an apply-mappings body', () => {
  it('lists the transactions to file, with the pattern each one teaches', () => {
    expect(
      checkApplyMappings({
        mappings: [
          { transaction_id: 12, category_id: 3, pattern: 'Netflix' },
          { transaction_id: '13', category_id: '3', pattern: 2026 },
          { transaction_id: 14, category_id: 3, pattern: '  ' },
          { transaction_id: 15, category_id: 3 },
        ],
      })
    ).toEqual({
      ok: true,
      value: [
        { transaction_id: 12, category_id: 3, pattern: 'Netflix' },
        { transaction_id: 13, category_id: 3, pattern: '2026' },
        { transaction_id: 14, category_id: 3, pattern: '  ' },
        { transaction_id: 15, category_id: 3, pattern: null },
      ],
    })
  })

  it('takes an empty list', () => {
    expect(checkApplyMappings({ mappings: [] })).toEqual({ ok: true, value: [] })
  })

  it('needs a list', () => {
    for (const body of [null, 'x', [], { mappings: 'all' }, { mapping_ids: [1] }]) {
      expect(fieldsOf(checkApplyMappings(body))).toEqual({ mappings: M.mappings })
    }
  })

  it('names a wrong field of an entry by its place in the list', () => {
    expect(
      fieldsOf(
        checkApplyMappings({
          mappings: [
            { transaction_id: 12, category_id: 3 },
            { transaction_id: 'x', category_id: 0, pattern: { text: 'x' } },
            'not an entry',
          ],
        })
      )
    ).toEqual({
      'mappings.1.transaction_id': M.transaction,
      'mappings.1.category_id': M.category,
      'mappings.1.pattern': M.patternText,
      'mappings.2.transaction_id': M.transaction,
      'mappings.2.category_id': M.category,
    })
  })

  it("refuses another profile's category at its entry", () => {
    expect(foreignMappingCategory(3)).toEqual({ 'mappings.3.category_id': M.category })
  })
})

describe('a learned pattern', () => {
  it('is kept in lower case letters and digits', () => {
    expect(learnedPattern('Netflix Monthly!')).toBe('netflixmonthly')
    expect(learnedPattern('A-B-C 12')).toBe('abc12')
  })

  it('is not learned when that leaves fewer than three characters', () => {
    expect(learnedPattern('ab')).toBeNull()
    expect(learnedPattern('a-b')).toBeNull()
    expect(learnedPattern('!!!')).toBeNull()
    expect(learnedPattern(null)).toBeNull()
  })
})

describe('an auto-map body', () => {
  it('names transactions by id, or a description and an amount, or neither', () => {
    expect(checkAutoMap({ transaction_ids: [1, '2'] })).toEqual({
      ok: true,
      value: { transaction_ids: [1, 2], description: null, amount: undefined },
    })
    expect(checkAutoMap({ description: 'Netflix', amount: 9.99 })).toEqual({
      ok: true,
      value: { transaction_ids: null, description: 'Netflix', amount: 9.99 },
    })
    expect(checkAutoMap({})).toEqual({
      ok: true,
      value: { transaction_ids: null, description: null, amount: undefined },
    })
    expect(checkAutoMap({ transaction_ids: [] })).toMatchObject({
      value: { transaction_ids: null },
    })
  })

  it('needs transaction ids as a list of ids', () => {
    for (const transaction_ids of ['all', 12, [1, 'x'], [0], { id: 1 }]) {
      expect(fieldsOf(checkAutoMap({ transaction_ids }))).toEqual({
        transaction_ids: M.transactionIds,
      })
    }
  })

  it('needs a description as text', () => {
    expect(fieldsOf(checkAutoMap({ description: 12, amount: 3 }))).toEqual({
      description: M.description,
    })
  })

  it('narrows to a description only with an amount, and only without ids', () => {
    const read = (body: unknown) => {
      const checked = checkAutoMap(body)
      if (!checked.ok) throw new Error('refused')
      return autoMapsByDescription(checked.value)
    }
    expect(read({ description: 'Netflix', amount: 9.99 })).toBe(true)
    expect(read({ description: 'Netflix', amount: 0 })).toBe(false)
    expect(read({ description: 'Netflix' })).toBe(false)
    expect(read({ description: '', amount: 3 })).toBe(false)
    expect(read({ description: 'Netflix', amount: 3, transaction_ids: [4] })).toBe(false)
  })

  it('looks for a description in lower case letters and digits', () => {
    expect(autoMapDescription(' Netflix 9.99 ')).toBe('netflix999')
  })
})

describe('what auto-map suggests', () => {
  const streaming: MatchCategory = { id: 1, name: 'Streaming', color: '#225588', type: 'expense' }
  const dining: MatchCategory = { id: 2, name: 'Dining', color: '#aa5500', type: 'expense' }
  const learned = (pattern: string, categoryId: number, useCount = 1, id = 1): LearnedMapping => ({
    id,
    pattern,
    category_id: categoryId,
    confidence: 0.9,
    use_count: useCount,
  })

  it('takes a learned mapping first, raised by its uses', () => {
    expect(
      suggestCategory(
        { description: 'Netflix monthly' },
        [streaming, dining],
        [learned('netflix', 1)]
      )
    ).toEqual({
      category_id: 1,
      category_name: 'Streaming',
      category_color: '#225588',
      confidence: 0.9 * (1 + Math.log10(2) * 0.2),
    })
  })

  it('raises a confidence by half at most, and answers no more than 1', () => {
    const suggestion = suggestCategory(
      { description: 'Netflix' },
      [streaming],
      [learned('netflix', 1, 1_000_000)]
    )
    expect(suggestion?.confidence).toBe(1)
  })

  it('reads the beneficiary and the payor too, in matching form', () => {
    expect(
      suggestCategory(
        { description: 'Card 0042', beneficiary: 'NET-FLIX' },
        [streaming],
        [learned('Net flix', 1)]
      )
    ).toMatchObject({ category_id: 1 })
    expect(
      suggestCategory(
        { description: 'Transfer', payor: 'Netflix BV' },
        [streaming],
        [learned('netflix', 1)]
      )
    ).toMatchObject({ category_id: 1 })
  })

  it("then the merchant dictionary, for the profile's category of that name", () => {
    expect(MERCHANT_DICTIONARY).toContainEqual({
      pattern: 'starbucks',
      category: 'Dining',
      confidence: 0.95,
    })
    expect(suggestCategory({ description: 'STARBUCKS 0815' }, [streaming, dining], [])).toEqual({
      category_id: 2,
      category_name: 'Dining',
      category_color: '#aa5500',
      confidence: 0.95,
    })
  })

  it("then a category whose name holds the transaction's words, scored by how many", () => {
    expect(
      suggestCategory(
        { description: 'Gym 12' },
        [streaming, { id: 9, name: 'Gym pool', color: null }],
        []
      )
    ).toEqual({
      category_id: 9,
      category_name: 'Gym pool',
      category_color: null,
      confidence: 0.5 / 2,
    })
  })

  it('suggests nothing when nothing matches', () => {
    expect(suggestCategory({ description: 'Zq 4417' }, [streaming, dining], [])).toBeNull()
  })

  it('decides a tie by type, then name, whatever order the categories come in', () => {
    const alpha: MatchCategory = { id: 7, name: 'Gym alpha', color: null, type: 'expense' }
    const beta: MatchCategory = { id: 5, name: 'Gym beta', color: null, type: 'expense' }
    const income: MatchCategory = { id: 8, name: 'Gym income', color: null, type: 'income' }
    for (const order of [
      [alpha, beta, income],
      [income, beta, alpha],
    ]) {
      expect(suggestCategory({ description: 'Gym 1' }, order, [])).toMatchObject({
        category_id: 7,
      })
    }
  })

  it('decides between two learned mappings by the one saved first', () => {
    const mappings = [learned('flix', 2, 1, 9), learned('netflix', 1, 1, 3)]
    expect(
      suggestCategory({ description: 'Netflix' }, [streaming, dining], mappings)
    ).toMatchObject({ category_id: 1 })
  })
})
