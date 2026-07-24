import type { Transaction } from '../types/models'

export interface AccountActivityPresentation {
  tone: Transaction['type']
  prefix: '+' | '-' | '±'
}

/** Visual treatment for an amount in an account card's recent-activity list. */
export function accountActivityPresentation(
  type: Transaction['type']
): AccountActivityPresentation {
  if (type === 'expense') return { tone: 'expense', prefix: '-' }
  if (type === 'transfer') return { tone: 'transfer', prefix: '±' }
  return { tone: 'income', prefix: '+' }
}
