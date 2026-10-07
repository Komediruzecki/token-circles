/**
 * A person's calendar date, computed the same way in both runtimes.
 *
 * "Today" depends on where the person is. At 00:30 in Zagreb it is already the 8th while UTC is
 * still on the 7th, and at 20:00 in Los Angeles it is still the 7th while UTC has moved on to the
 * 8th. The app dates what a person enters with their own calendar, so anything that asks "is this
 * today, this month, overdue, due soon?" has to ask it on that calendar too.
 *
 * The Worker runs on UTC whatever the host says, so it cannot read the person's calendar off its
 * own clock. The app sends its IANA zone instead (X-Time-Zone, see worker/src/local-date.ts) and
 * these helpers turn the current instant into that zone's wall clock. The browser has the
 * person's zone as its local one, so local-first code reads its local clock and needs none of
 * this (frontend/src/utils/period.ts, localToday).
 */

// IANA names: "Europe/Zagreb", "America/Argentina/Buenos_Aires", "Etc/GMT+5", "UTC".
// A UTC offset such as "+02:00" is not a zone: it has no daylight-saving rules, so a client that
// sent one would be told the wrong date for half the year.
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const MAX_ZONE_LENGTH = 64;

// One formatter per zone, made once. Only zones the runtime accepted are ever stored, so the map
// is bounded by the time-zone database (about 600 names), not by what clients send.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws a RangeError for a zone this runtime does not know; nothing is stored then.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** True for a time zone this runtime knows by its IANA name. Offsets and anything else: false. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_ZONE_LENGTH || !ZONE_NAME.test(value)) {
    return false;
  }
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The wall clock in `timeZone` at the instant `now`, as a Date whose UTC fields hold it:
 * getUTCFullYear(), getUTCMonth(), getUTCDate() and getUTCHours() read the person's calendar and
 * clock, and toISOString().slice(0, 10) is their date.
 *
 * It is the instant `now` only in UTC. Never store it as a timestamp or compare it with one.
 * Throws a RangeError for a zone the runtime does not know; check with isTimeZone first.
 */
export function wallClockIn(timeZone: string, now: Date = new Date()): Date {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const wall = new Date(0);
  // setUTCFullYear, not Date.UTC: Date.UTC reads a two-digit year as 19xx.
  wall.setUTCFullYear(parts.year!, parts.month! - 1, parts.day!);
  // Some engines still print midnight as 24 even with hourCycle h23.
  wall.setUTCHours(parts.hour! % 24, parts.minute!, parts.second!, now.getUTCMilliseconds());
  return wall;
}

/** The calendar date in `timeZone` at the instant `now`, as YYYY-MM-DD. */
export function calendarDateIn(timeZone: string, now: Date = new Date()): string {
  return wallClockIn(timeZone, now).toISOString().slice(0, 10);
}
