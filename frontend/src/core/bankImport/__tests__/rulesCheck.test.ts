/**
 * core/bankImport/rulesCheck.ts: what a Bank Imports rule needs before the editor saves it. Every
 * rule and every message.
 */
import { describe, expect, it } from 'vitest'
import { BANK_RULE_MESSAGES as M, checkBankRuleDrafts, keywordsOf } from '../rulesCheck'

const rule = (category: string, keywords: string) => ({ category, keywords })
const counterpart = (signature: string, account: string) => ({ signature, account })

describe('the words', () => {
  it('say how to put each part right', () => {
    expect(M).toEqual({
      category: 'Name the category these keywords file into, or remove the rule.',
      keywords: 'Add a keyword to match, like "konzum", or remove the rule.',
      account: 'Choose the account this signature stands for, or remove it.',
      signature: "Add the text that marks this account, like a card's last 4 digits, or remove it.",
    })
  })
})

describe('keywords', () => {
  it('are comma-separated, trimmed, and none empty', () => {
    expect(keywordsOf(' konzum, , lidl ,')).toEqual(['konzum', 'lidl'])
    expect(keywordsOf(' , ')).toEqual([])
  })
})

describe('a category rule', () => {
  it('passes whole, and passes wholly empty', () => {
    expect(
      checkBankRuleDrafts({
        categoryRules: [rule('Groceries', 'konzum, lidl'), rule('', ''), rule('  ', ' , ')],
        counterparts: [],
      })
    ).toEqual({})
  })

  it('needs a keyword when it names a category', () => {
    expect(
      checkBankRuleDrafts({ categoryRules: [rule('Groceries', ' , ')], counterparts: [] })
    ).toEqual({ 'categoryRules.0.keywords': M.keywords })
  })

  it('needs a category when it has keywords', () => {
    expect(
      checkBankRuleDrafts({
        categoryRules: [rule('Groceries', 'konzum'), rule(' ', 'netflix')],
        counterparts: [],
      })
    ).toEqual({ 'categoryRules.1.category': M.category })
  })
})

describe('a counterpart', () => {
  it('passes whole, and passes wholly empty', () => {
    expect(
      checkBankRuleDrafts({
        categoryRules: [],
        counterparts: [counterpart('1111', 'Everyday'), counterpart(' ', '')],
      })
    ).toEqual({})
  })

  it('needs an account when it has a signature, and a signature when it has an account', () => {
    expect(
      checkBankRuleDrafts({
        categoryRules: [],
        counterparts: [counterpart('1111', ''), counterpart('', 'Everyday')],
      })
    ).toEqual({ 'counterparts.0.account': M.account, 'counterparts.1.signature': M.signature })
  })
})
