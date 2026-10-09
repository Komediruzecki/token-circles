/**
 * A saved import source ("Connected Sources", worker migration 0020): a Google Sheet link, and
 * later a Drive folder or a bank connection, that the Import page fetches again on demand or on a
 * schedule. The Worker route, the local-first handler and a backup's restore in both runtimes
 * read these lists, so a kind or a schedule means the same thing wherever a source is stored.
 */

/** What a source fetches from. */
export const IMPORT_SOURCE_KINDS = [
  'google_sheet',
  'google_drive_folder',
  'bank_aggregator',
] as const;

/** When a source is fetched: when a person presses Import, when the app opens, or every day. */
export const IMPORT_SOURCE_SCHEDULES = ['manual', 'on_open', 'daily'] as const;

/**
 * The schedules that run on our machines rather than a person's, which a paid plan buys
 * (`automatedImports` in worker/src/plans.ts). Local-first runs every schedule itself.
 */
export const AUTOMATED_IMPORT_SCHEDULES: readonly string[] = ['on_open', 'daily'];

export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];
export type ImportSourceSchedule = (typeof IMPORT_SOURCE_SCHEDULES)[number];

export function isImportSourceKind(value: unknown): value is ImportSourceKind {
  return typeof value === 'string' && (IMPORT_SOURCE_KINDS as readonly string[]).includes(value);
}

export function isImportSourceSchedule(value: unknown): value is ImportSourceSchedule {
  return (
    typeof value === 'string' && (IMPORT_SOURCE_SCHEDULES as readonly string[]).includes(value)
  );
}

/**
 * A JSON column of a source (config, mapping, category types) as an object: the Worker stores it
 * as text, local-first as the object itself, and a backup from either carries whichever it had.
 * Answers `fallback` for anything that is not an object, or text that does not read as one.
 */
export function sourceJsonObject(
  value: unknown,
  fallback: Record<string, unknown> | null
): Record<string, unknown> | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : fallback;
}
