/**
 * An account's balance today, and setting it to what the bank shows (review M2).
 *
 * Both runtimes store an account's balance as its opening balance and every entry, those dated
 * after today included (`accountsToday` in shared/guidance/facts.ts). A bank shows what has
 * happened by today. So a figure typed as "what your bank shows now" moves the opening balance:
 * the entries up to today are worked back from it, and those dated after today go on top, as
 * they will once their day comes. The stored balance and the opening balance move together, as
 * an edit on Accounts moves them (frontend/src/features/accountForm.ts), so the change survives a
 * recompute.
 *
 * Pure, and used by both runtimes' callers: the frontend reads and writes through the storage
 * seam, so one rule serves the Worker and local-first.
 */
import { balanceMoves } from './guidance/facts';
import type { FactsEntry } from './guidance/facts';

const cents = (n: number): number => Math.round(n * 100) / 100;

/** What the entries dated after `today` (YYYY-MM-DD) move on account `id`. */
export function movedAfterToday(id: number, entries: readonly FactsEntry[], today: string): number {
  let moved = 0;
  for (const entry of entries) {
    if (entry.date.slice(0, 10) <= today) continue;
    for (const move of balanceMoves(entry)) {
      if (move.account === id) moved += move.delta;
    }
  }
  return cents(moved);
}

/**
 * The opening balance and the stored balance that make an account read `figure` today, given
 * what the entries dated after today move on it (`later`, from `movedAfterToday`).
 */
export function balancesForToday(
  account: { balance: number; starting_balance?: number | null },
  later: number,
  figure: number
): { starting_balance: number; balance: number } {
  const balance = cents(figure + later);
  return {
    starting_balance: cents((account.starting_balance ?? 0) + (balance - account.balance)),
    balance,
  };
}
