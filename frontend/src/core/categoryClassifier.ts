/**
 * Auto-detect category type from its name using keyword matching.
 * Used by the Import page to pre-classify categories during column mapping.
 */

const incomeKeywords = [
  'salary',
  'income',
  'wages',
  'wage',
  'payroll',
  'revenue',
  'dividend',
  'refund',
  'bonus',
  'paycheck',
  'pay cheque',
  'interest',
  'credit',
  'received',
  'royalt',
  'reimbursement',
]

const accountKeywords = [
  'current account',
  'giro account',
  'checking account',
  'savings account',
  'investment account',
  'credit card account',
  'account',
  'checking',
  'savings',
  'giro',
  'current',
  'wallet',
  'portfolio',
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

export function classifyCategory(name: string): CategoryType {
  const lower = name.toLowerCase()
  if (incomeKeywords.some((kw) => lower.includes(kw))) return 'income'
  if (accountKeywords.some((kw) => lower.includes(kw))) return 'account'
  return 'expense'
}
