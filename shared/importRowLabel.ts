/**
 * Human identifier for a spreadsheet row rejected during import.
 *
 * A rejection used to be reported as a bare row number ("Row 285: …"), which meant scrolling a
 * 4,000-line sheet and counting — and the count is off by the header row, so it often landed on
 * the wrong line. Quoting the row's own date and description lets the user find it with a search
 * instead. Shared so the Worker and the IndexedDB import path label rows identically.
 */

const MAX_DESCRIPTION = 60;
const MAX_DATE = 24;

// A leading calendar date, ISO or day/month/year, with or without a time after it.
const LEADING_DATE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/;

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Trim a date cell down to its calendar day — imported sheets often carry a time or a full
 * timestamp. Only trims when the value actually LEADS with a date: an unconditional slice(0, 10)
 * cut unrecognised values mid-token, which is how a Google Visualization date reached the user
 * as `Date(2026,` instead of `Date(2026,1,7)`.
 */
function dayOf(value: unknown): string {
  const raw = text(value);
  const match = raw.match(LEADING_DATE);
  if (match) return match[0];
  return raw.length > MAX_DATE ? `${raw.slice(0, MAX_DATE - 1)}…` : raw;
}

/** `2026-05-04 · Top-up by *1111`, or as much of it as the row actually has. */
export function importRowLabel(date: unknown, description: unknown): string {
  const day = dayOf(date);
  const what = text(description);
  const trimmed = what.length > MAX_DESCRIPTION ? `${what.slice(0, MAX_DESCRIPTION - 1)}…` : what;
  if (day && trimmed) return `${day} · ${trimmed}`;
  return day || trimmed;
}
