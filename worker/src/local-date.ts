import type { Context, MiddlewareHandler } from 'hono';
import { calendarDateIn, isTimeZone, wallClockIn } from '../../shared/calendarDate';
import type { AppEnv } from './index';

// The person's calendar, for a Worker whose clock is UTC.
//
// workerd runs on UTC whatever the host's zone is, so `new Date().toISOString().slice(0, 10)` and
// `new Date().getMonth()` are the UTC date and month. East of UTC that date is still yesterday for
// the first hours of every local day (00:00-02:00 in CEST); west of UTC it is already tomorrow
// every evening. The app dates what a person enters with their own calendar, so a range that
// ended on the UTC date left today's transactions out of the monthly totals, and a bill marked
// paid at 00:30 was stamped with yesterday.
//
// The app sends its IANA zone on every request (frontend/src/core/apiFetch.ts). The middleware
// keeps it when this runtime knows the zone and ignores it otherwise, so a request without a
// usable one (an API token, the MCP endpoint, an app older than the header) gets the UTC calendar,
// as every request did before.
//
// Not for instants. A timestamp (created_at, an expiry, a rate-limit window) is the same instant
// everywhere and stays `new Date()`.

export const TIME_ZONE_HEADER = 'X-Time-Zone';

const FALLBACK_ZONE = 'UTC';

/** Reads X-Time-Zone once per request into `timeZone`: a zone this runtime knows, else UTC. */
export const readTimeZone: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sent = c.req.header(TIME_ZONE_HEADER);
  c.set('timeZone', isTimeZone(sent) ? sent : FALLBACK_ZONE);
  await next();
};

/** The zone this request's calendar is in. UTC when the request sent none the runtime knows. */
export function requestTimeZone(c: Context<AppEnv>): string {
  return c.get('timeZone') ?? FALLBACK_ZONE;
}

/** Today on the person's calendar, YYYY-MM-DD. */
export function localToday(c: Context<AppEnv>): string {
  return calendarDateIn(requestTimeZone(c));
}

/** This month on the person's calendar, YYYY-MM. */
export function localMonth(c: Context<AppEnv>): string {
  return localToday(c).slice(0, 7);
}

/**
 * The person's wall clock now, as a Date whose fields hold it. workerd's Date is UTC, so
 * getFullYear(), getMonth() and getDate(), and setMonth()/setDate() arithmetic, all run on the
 * person's calendar, and toISOString().slice(0, 10) is their date. It is a drop-in for the
 * `new Date()` a route used to read "today" or "this month" from.
 *
 * It is the current instant only in UTC. Never store it as a timestamp or compare it with one.
 */
export function localNow(c: Context<AppEnv>): Date {
  return wallClockIn(requestTimeZone(c));
}
