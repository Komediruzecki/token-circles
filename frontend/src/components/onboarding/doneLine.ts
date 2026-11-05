/**
 * The line under setup's "Your orbit is set": what the profile holds (review M20).
 *
 * It counted what this visit made, in memory. A reload on the subscriptions step, where the cloud
 * reopens setup (and local-first does too, since M7), left nothing counted, and the two runtimes
 * read "Personal Profile has 1 tracked subscription." and "1 account, 69 new transactions and 1
 * tracked subscription" for the same statement. The line now counts the profile's own rows, read
 * through the storage seam by the evaluation the done step runs anyway: the same in both runtimes,
 * and after a reload.
 */
import { counted, listed } from './FirstImport'
import type { AchievementsSnapshot } from '../../core/achievementsStore'

export interface ProfileHolds {
  accounts: number
  transactions: number
  /** The bills and subscriptions it tracks: a paused one is not tracked. */
  bills: number
}

/**
 * "Personal Profile has 1 account, 69 transactions and 2 regular payments tracked on Bills."
 *
 * One word and one count for what Bills holds, as the day-7 mail says it (review M12): the line
 * called a rent and a streaming plan "2 tracked subscriptions" while the mail split them in two.
 */
export function doneLine(name: string, holds: ProfileHolds): string {
  const parts: string[] = []
  if (holds.accounts > 0) parts.push(counted(holds.accounts, 'account'))
  if (holds.transactions > 0) parts.push(counted(holds.transactions, 'transaction'))
  if (holds.bills > 0) {
    parts.push(
      counted(holds.bills, 'regular payment tracked on Bills', 'regular payments tracked on Bills')
    )
  }
  return parts.length > 0 ? `${name} has ${listed(parts)}.` : `${name} is ready.`
}

/**
 * What an evaluation's rows hold. `accounts` stands in for the accounts when the evaluation could
 * not read them.
 */
export function holdsOf(
  snap: Pick<AchievementsSnapshot, 'transactions' | 'bills' | 'accounts'>,
  accounts: number
): ProfileHolds {
  return {
    accounts: snap.accounts?.length ?? accounts,
    transactions: snap.transactions.length,
    bills: snap.bills.filter((b) => b.is_active !== 0 && b.is_active !== false).length,
  }
}
