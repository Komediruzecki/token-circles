/**
 * The net worth timeline, GET /api/accounts/history/timeline, from the balances recorded for the
 * accounts. Both runtimes answer it with this.
 *
 * A day's figure is each account's latest recorded balance on or before that day. It used to be
 * the sum of the balances recorded on that day alone: two snapshots of one account on one day
 * counted twice, and a day on which only some accounts had a snapshot showed only theirs, as if
 * the others held nothing.
 */
import { toCents } from './money';

export interface BalanceSnapshot {
  /** The account the balance was recorded for. */
  account: number;
  /** The day it belongs to on the person's calendar, YYYY-MM-DD. */
  day: string;
  /** The snapshot's own id. Of two on one day for one account, the one recorded last counts. */
  id: number;
  balance: number;
}

export interface NetWorthPoint {
  date: string;
  net_worth: number;
}

/**
 * One point for each day on which a balance was recorded, oldest first. An account counts from its
 * first snapshot on: before it, nothing is known of it.
 */
export function netWorthTimeline(snapshots: readonly BalanceSnapshot[]): NetWorthPoint[] {
  const ordered = snapshots
    .filter((s) => s.day !== '' && Number.isFinite(s.balance))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id - b.id));
  const latest = new Map<number, number>();
  const timeline: NetWorthPoint[] = [];
  ordered.forEach((snapshot, i) => {
    latest.set(snapshot.account, snapshot.balance);
    // The day's figure once its last snapshot is in.
    if (ordered[i + 1]?.day === snapshot.day) return;
    let total = 0;
    for (const balance of latest.values()) total += balance;
    timeline.push({ date: snapshot.day, net_worth: toCents(total) });
  });
  return timeline;
}
