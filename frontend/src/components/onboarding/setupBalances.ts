/**
 * Setup's "Balance today" is what the bank shows now (review M2). It becomes the account's opening
 * balance when setup makes the account, so a statement imported after it would add up on top:
 * 1,240.50 typed and a statement netting 1,865.87 read 3,106.37. After each statement, every
 * account given a balance in setup since it was last finished or left (core/setupTypedBalances.ts)
 * is set to read that balance as of the day it was typed, with what the statement brought in worked
 * back from it (core/balanceToday.ts).
 */
import { setBalanceToday, storedAccounts } from '../../core/balanceToday'
import type { TypedBalance } from '../../core/setupTypedBalances'

/** The two calls it makes, which a test can stand in for. */
interface Calls {
  storedAccounts: typeof storedAccounts
  setBalanceToday: typeof setBalanceToday
}

/** The names of the accounts whose balance it set. */
export async function workBackTypedBalances(
  typed: readonly TypedBalance[],
  calls: Calls = { storedAccounts, setBalanceToday }
): Promise<string[]> {
  if (typed.length === 0) return []
  const stored = await calls.storedAccounts()
  const set: string[] = []
  for (const one of typed) {
    const account = stored.find((candidate) => candidate.id === one.id)
    if (account && (await calls.setBalanceToday(account, one.figure, one.asOf))) {
      set.push(account.name)
    }
  }
  return set
}
