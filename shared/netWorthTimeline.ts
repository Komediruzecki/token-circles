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

/** A time that names its zone: Z, or an offset such as +09:00. */
const ZONED = /[zZ]|[+-]\d\d:?\d\d$/;

/**
 * The day a balance snapshot belongs to on the person's calendar, `dayOf` giving an instant's
 * day there: the caller's zone on the Worker, the device's in local-first.
 *
 * One an import made holds a bare date, which is already the day. One recorded through the app
 * holds an instant. A time that names no zone, "YYYY-MM-DD HH:MM:SS", is what the cloud column's
 * datetime('now') default writes, and it is UTC. Local-first read it as the device's own time, so
 * 23:30 on the 7th went under the 7th in Tokyo, where the Worker filed it under the 8th.
 */
export function snapshotDay(recorded: unknown, dayOf: (instant: Date) => string): string {
  const text = typeof recorded === 'string' ? recorded : '';
  if (text.length <= 10) return text;
  const instant = new Date(ZONED.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(instant.getTime()) ? text.slice(0, 10) : dayOf(instant);
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
