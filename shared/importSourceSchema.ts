/**
 * A saved import source ("Connected Sources", worker migration 0020): a Google Sheet link, and
 * later a Drive folder or a bank connection, that the Import page fetches again on demand or on a
 * schedule. The Worker route, the local-first handler and a backup's restore in both runtimes
 * read these lists, so a kind or a schedule means the same thing wherever a source is stored.
 *
 * What a source body may hold, and the Google Sheet link the Import page fetches
 * (POST /api/import/googlesheet), are checked here too, in one set of words for both runtimes and
 * the forms (docs/plans/2026-10-07-form-errors.md, slice 4b). Both runtimes used to refuse a kind
 * or a schedule as "Invalid kind" and "Invalid schedule", naming no field; cut a long name to 200
 * characters, and stored a name or settings that were not text or an object as empty, without a
 * word; took an account of another profile, or anything at all, as the default account; and saved
 * a sheet with no link to fetch. The rules:
 *
 * - The kind and the schedule are among the lists above; google_sheet and manual when left out.
 * - The name is text of at most 200 characters, or blank.
 * - The settings (`config`) are an object. A sheet's carry its link, which reads as a Google
 *   Sheet's: one with `/d/<the sheet's id>` in it.
 * - The default account is one of the profile's accounts, by id, or none. Whose account it is
 *   needs the profile's accounts, so the runtimes ask that themselves, in these words.
 * - An edit checks only the fields it sends: a source saved under older rules can still be renamed
 *   or synced.
 */
import { asId, asRecord, isBlank } from './fieldReaders';
import type { Read } from './fieldReaders';
import type { Checked, FieldErrors } from './refusal';

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

/** The longest name a source may have. */
export const IMPORT_SOURCE_LABEL_MAX = 200;

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const IMPORT_SOURCE_MESSAGES = {
  url: 'Paste the link to a Google Sheet. It starts with https://docs.google.com/spreadsheets/d/.',
  label: 'Give the source a name as text, or leave it blank.',
  labelLength: `Keep the name to ${IMPORT_SOURCE_LABEL_MAX} characters or fewer.`,
  kind: 'Choose google_sheet, google_drive_folder or bank_aggregator.',
  schedule: 'Choose manual, on_open or daily.',
  config:
    'Send the settings as an object, like {"url": "https://docs.google.com/spreadsheets/d/..."}.',
  account: 'Choose an account from the list, or leave it blank.',
  notFound: 'Source not found',
} as const;

const M = IMPORT_SOURCE_MESSAGES;

/** A Google Sheet's link, with the sheet's id and the tab's gid. */
export interface SheetLink {
  url: string;
  id: string;
  gid: string | null;
}

/** A Google Sheet's link, trimmed, or why not: it needs `/d/<the sheet's id>`. */
export function readSheetUrl(raw: unknown): Read<SheetLink> {
  const url = typeof raw === 'string' ? raw.trim() : '';
  const id = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) return { error: M.url };
  return { value: { url, id, gid: url.match(/[?&#]gid=([0-9]+)/)?.[1] ?? null } };
}

/** What POST /api/import/googlesheet fetches: the sheet's link and the tab, or why not. */
export function checkSheetFetch(
  body: unknown
): Checked<{ url: string; id: string; gid: string | null; sheetName: string }> {
  const raw = asRecord(body);
  const link = readSheetUrl(raw.url);
  if ('error' in link) return { ok: false, fields: { url: link.error } };
  const sheetName = typeof raw.sheetName === 'string' ? raw.sheetName : '';
  return { ok: true, value: { ...link.value, sheetName } };
}

/** The columns of a source a body may write, as each runtime stores them (objects, not text). */
export interface ImportSourceWrite {
  kind?: ImportSourceKind;
  label?: string;
  config?: Record<string, unknown>;
  mapping?: Record<string, unknown> | null;
  category_types?: Record<string, unknown> | null;
  default_account_id?: number | null;
  schedule?: ImportSourceSchedule;
  last_synced_at?: string | null;
  last_cursor?: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The fields of a source body, checked: on a new source (`stored` undefined) every column, with
 * its default; on an edit only the ones the body sends, checked against the kind the source keeps
 * when the body does not change it.
 */
function checkSource(
  body: unknown,
  stored: { kind?: unknown } | undefined
): Checked<ImportSourceWrite> {
  const b = asRecord(body);
  const creating = stored === undefined;
  const sends = (key: string) => creating || key in b;
  const fields: FieldErrors = {};
  const value: ImportSourceWrite = {};

  if (sends('kind')) {
    const kind = isBlank(b.kind) ? 'google_sheet' : b.kind;
    if (isImportSourceKind(kind)) value.kind = kind;
    else fields.kind = M.kind;
  }
  if (sends('label')) {
    if (b.label === undefined || b.label === null) value.label = '';
    else if (typeof b.label !== 'string') fields.label = M.label;
    else if (b.label.trim().length > IMPORT_SOURCE_LABEL_MAX) fields.label = M.labelLength;
    else value.label = b.label.trim();
  }
  if (sends('config')) {
    if (b.config === undefined || b.config === null) value.config = {};
    else if (isObject(b.config)) value.config = { ...b.config };
    else fields.config = M.config;
  }
  // A sheet's settings carry the link it is fetched from.
  const kind = value.kind ?? (creating ? undefined : stored.kind);
  if (value.config && kind === 'google_sheet' && (creating || 'config' in b)) {
    const link = readSheetUrl(value.config.url);
    if ('error' in link) fields['config.url'] = link.error;
    else value.config.url = link.value.url;
  }
  if ('mapping' in b) value.mapping = isObject(b.mapping) ? b.mapping : null;
  if ('category_types' in b) {
    value.category_types = isObject(b.category_types) ? b.category_types : null;
  }
  if ('default_account_id' in b) {
    if (isBlank(b.default_account_id)) value.default_account_id = null;
    else {
      const id = asId(b.default_account_id);
      if (id === null) fields.default_account_id = M.account;
      else value.default_account_id = id;
    }
  }
  if (sends('schedule')) {
    const schedule = isBlank(b.schedule) ? 'manual' : b.schedule;
    if (isImportSourceSchedule(schedule)) value.schedule = schedule;
    else fields.schedule = M.schedule;
  }
  // The page's own stamps after a sync, kept as the runtimes always kept them.
  if ('last_synced_at' in b) {
    value.last_synced_at =
      typeof b.last_synced_at === 'string' ? b.last_synced_at.slice(0, 40) : null;
  }
  if ('last_cursor' in b) {
    value.last_cursor = typeof b.last_cursor === 'string' ? b.last_cursor.slice(0, 200) : null;
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

/** A new source: every column, with its default, or why not. */
export function checkImportSourceCreate(body: unknown): Checked<ImportSourceWrite> {
  return checkSource(body, undefined);
}

/** An edit of a stored source: only the columns the body sends, or why not. */
export function checkImportSourceEdit(
  body: unknown,
  stored: { kind?: unknown }
): Checked<ImportSourceWrite> {
  return checkSource(body, stored);
}

/** The refusal for a default account that is not one of the profile's. */
export const foreignSourceAccount = (): FieldErrors => ({ default_account_id: M.account });
