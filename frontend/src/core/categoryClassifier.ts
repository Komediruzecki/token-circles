/**
 * Auto-detect category type from its name using keyword matching.
 * Used by the Import page to pre-classify categories during column mapping.
 *
 * Keywords match whole words and whole phrases, never parts of a word: "ib" is Interactive
 * Brokers, not the middle of "Library", and "wise" is the bank, not the end of "Otherwise". A
 * word is a run of letters or digits in any script, so "Plaća" and "Überweisung" stay one word
 * each (JS `\b` knows only ASCII letters and would end a word at "ć" or start one after "Ü").
 * A camel-case name is also read split at its capitals, so "WRev" holds the word "rev" while
 * "PayPal" still matches "paypal" as written.
 *
 * Plurals and other forms are spelled out rather than matched by stem: the lists below are
 * everything that matches.
 */

const incomeKeywords = [
  'salary',
  'salaries',
  'income',
  'wages',
  'wage',
  'payroll',
  'revenue',
  'revenues',
  'dividend',
  'dividends',
  'refund',
  'refunds',
  'bonus',
  'bonuses',
  'paycheck',
  'paychecks',
  'pay cheque',
  'pay cheques',
  'interest',
  'credit',
  'received',
  'royalty',
  'royalties',
  'reimbursement',
  'reimbursements',
]

/**
 * Account names of more than one word. They are checked before the income keywords, so "Credit
 * card account" is the account it names, not income because it contains "credit".
 */
const accountPhrases = [
  'current account',
  'giro account',
  'checking account',
  'savings account',
  'investment account',
  'credit card account',
]

const accountWords = [
  'ib',
  'ibkr',
  'interactive',
  'broker',
  'brokers',
  'brokerage',
  'trading',
  'trading212',
  // "Investments" (or "Investment") is treated as an asset account: it holds value and should
  // count toward net worth, which only accounts do. Users can still override in the mapping step.
  'investment',
  'investments',
  'account',
  'accounts',
  'checking',
  'savings',
  'giro',
  'girokonto',
  'current',
  'wallet',
  'wallets',
  'portfolio',
  'portfolios',
  'pbz',
  'revolut',
  'rev',
  'n26',
  'wise',
  'paypal',
  'bunq',
  'monzo',
  'starling',
]

export type CategoryType = 'income' | 'expense' | 'account'

/** The name's words, lowercased and joined by single spaces, with a space at each end. */
function wordsOf(name: string): string {
  const words = name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  return ` ${words.join(' ')} `
}

/** "WRev" -> "W Rev", "IBAccount" -> "IB Account". A name without inner capitals is unchanged. */
function splitCamelCase(name: string): string {
  return name.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
}

export function classifyCategory(name: string): CategoryType {
  const readings = [wordsOf(name), wordsOf(splitCamelCase(name))]
  const has = (keywords: string[]) =>
    keywords.some((kw) => readings.some((words) => words.includes(` ${kw} `)))
  if (has(accountPhrases)) return 'account'
  if (has(incomeKeywords)) return 'income'
  if (has(accountWords)) return 'account'
  return 'expense'
}
