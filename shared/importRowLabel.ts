/**
 * Human identifier for a spreadsheet row rejected during import.
 *
 * A rejection used to be reported as a bare row number ("Row 285: …"), which meant scrolling a
 * 4,000-line sheet and counting — and the count is off by the header row, so it often landed on
 * the wrong line. Quoting the row's own date and description lets the user find it with a search
 * instead. Shared so the Worker and the IndexedDB import path label rows identically.
 */

const MAX_DESCRIPTION = 60;

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** `2026-05-04 · Top-up by *1111`, or as much of it as the row actually has. */
export function importRowLabel(date: unknown, description: unknown): string {
  // Keep only the date part; imported sheets often carry a time or a full timestamp.
  const day = text(date).slice(0, 10);
  const what = text(description);
  const trimmed = what.length > MAX_DESCRIPTION ? `${what.slice(0, MAX_DESCRIPTION - 1)}…` : what;
  if (day && trimmed) return `${day} · ${trimmed}`;
  return day || trimmed;
}
