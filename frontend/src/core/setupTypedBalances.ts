/**
 * The balances typed in setup's "Balance today", kept until setup is finished or left (review M2).
 *
 * The figure is what the bank showed on the day it was typed, and a statement imported after it is
 * worked back from it (components/onboarding/setupBalances.ts). Setup can be left at the statement
 * step to go and export one, and come back after a reload, so the figures live in this browser's
 * storage rather than in the wizard: one per account setup made, with the day it was typed.
 */
const KEY = 'finance_setup_balances'

export interface TypedBalance {
  /** The account setup made. */
  id: number
  figure: number
  /** The day it was typed, YYYY-MM-DD: the bank's figure as of then. */
  asOf: string
}

const isTyped = (value: unknown): value is TypedBalance => {
  const one = value as Partial<TypedBalance> | null
  return (
    typeof one?.id === 'number' &&
    typeof one.figure === 'number' &&
    Number.isFinite(one.figure) &&
    typeof one.asOf === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(one.asOf)
  )
}

/** The balances typed in setup since it was last finished or left. */
export function typedBalances(): TypedBalance[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isTyped) : []
  } catch {
    return []
  }
}

/** Keeps the balance typed for account `id`, replacing an earlier one for it. */
export function rememberTypedBalance(one: TypedBalance): void {
  try {
    const kept = typedBalances().filter((other) => other.id !== one.id)
    localStorage.setItem(KEY, JSON.stringify([...kept, one]))
  } catch {
    // Storage refused: a statement then adds up on top of the balance, as it did before M2.
  }
}

/** Setup is finished or left: its balances say nothing about a later import. */
export function forgetTypedBalances(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing kept, or nothing to clear.
  }
}
