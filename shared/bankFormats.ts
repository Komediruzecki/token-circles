/**
 * The bank formats an import read, as `import_logs.bank_formats` holds them (migration 0038).
 *
 * The Bank Imports tab and the API's import recognise a statement by its bank's format
 * (shared/bankImport/registry.ts). Which formats a profile's imports came in is a hint to where
 * the person lives, for the official figures their numbers are set beside. It is kept in a column
 * of its own, the adapter ids joined by commas, because both runtimes cut an import log's
 * `details` at 8000 characters, and a cut leaves JSON that no longer parses.
 *
 * Every writer reads what it is given through `storedBankFormats`, so an id the app does not read
 * (a later build's adapter, or a client's guess) never reaches the column.
 */
import type { BankId } from './bankImport/types';

/** Every format the import reads, by adapter id, in the registry's order. */
export const BANK_FORMAT_IDS = [
  'revolut',
  'erste',
  'pbz',
  'n26',
  'wise',
  'ing',
  'sparkasse',
  'dkb',
  'ynab',
] as const satisfies readonly BankId[];

/** Whether `value` is the id of a format the import reads, exactly as stored. */
export function isBankFormat(value: unknown): value is BankId {
  return typeof value === 'string' && (BANK_FORMAT_IDS as readonly string[]).includes(value);
}

/**
 * The formats a writer was given, as the column stores them: the ones the app reads, lowercased,
 * each once, in the order given, joined by commas. Null for none. Takes a list or text with the
 * ids separated by commas; anything else is none.
 */
export function storedBankFormats(raw: unknown): string | null {
  const given = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const known: BankId[] = [];
  for (const entry of given) {
    const id = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
    if (isBankFormat(id) && !known.includes(id)) known.push(id);
  }
  return known.length > 0 ? known.join(',') : null;
}

/** The formats a stored value names, the ones the app reads only. */
export function bankFormatsOf(stored: unknown): BankId[] {
  const value = storedBankFormats(stored);
  return value === null ? [] : (value.split(',') as BankId[]);
}
