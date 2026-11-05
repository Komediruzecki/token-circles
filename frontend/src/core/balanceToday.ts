/**
 * Reading an account's balance today and setting it to what the bank shows (review M2), through
 * the storage seam, so the same calls serve the Worker and local-first. The rule is
 * shared/balanceToday.ts: the stored balance holds every entry, those dated after today included,
 * and setting the balance today moves the opening balance with it.
 *
 * Setup's "Balance today" is set this way after each statement it imports, and the Import page's
 * "Set today's balance" after any import.
 */
import { balancesForToday, movedAfterToday } from '../../../shared/balanceToday'
import { addDays } from '../../../shared/calendarMonths'
import { localToday } from '../utils/period'
import { apiGet, apiPut } from './api'
import type { FactsEntry } from '../../../shared/guidance/facts'

/** An account as both runtimes store it: its balance holds every entry. */
export interface StoredAccount {
  id: number
  name: string
  balance: number
  starting_balance?: number | null
}

/** The active profile's accounts, as stored. */
export async function storedAccounts(): Promise<StoredAccount[]> {
  const rows = await apiGet<StoredAccount[]>('/api/accounts')
  return Array.isArray(rows) ? rows : []
}

/** What the account's entries dated after `today` move on it. */
async function laterOn(id: number, today: string): Promise<number> {
  const query = new URLSearchParams({
    account_id: String(id),
    startDate: addDays(today, 1),
    limit: '1000',
  })
  const reply = await apiGet<FactsEntry[] | { rows?: FactsEntry[] }>(`/api/transactions?${query}`)
  const rows = Array.isArray(reply) ? reply : (reply.rows ?? [])
  return movedAfterToday(id, rows, today)
}

/** The account's balance today: what its stored balance holds up to the end of today. */
export async function balanceToday(account: StoredAccount, today = localToday()): Promise<number> {
  return Math.round((account.balance - (await laterOn(account.id, today))) * 100) / 100
}

/**
 * Sets the account's balance today to `figure`, moving its opening balance with it. False when it
 * read that already, and nothing was written.
 */
export async function setBalanceToday(
  account: StoredAccount,
  figure: number,
  today = localToday()
): Promise<boolean> {
  const next = balancesForToday(account, await laterOn(account.id, today), figure)
  if (
    Math.abs(next.balance - account.balance) < 0.005 &&
    Math.abs(next.starting_balance - (account.starting_balance ?? 0)) < 0.005
  ) {
    return false
  }
  await apiPut(`/api/accounts/${account.id}`, next)
  return true
}
