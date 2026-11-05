/**
 * The Import page at its Bank Imports tab: `#import/bank` (review M4).
 *
 * The day-2 mail says files from the banks the app knows import as they are, and its "Import
 * statements" opened `#import`, the page's first tab: Google Sheets, with a table of expected
 * columns. That mail and Getting started's import step open this address instead, where a
 * statement from one of those banks is read with its own columns. `#import` keeps opening the page
 * as it was. Shared, so the Worker's mails and the app's steps name the same address.
 */

export const BANK_IMPORT_HASH = '#import/bank';

/** The tab an Import address names: 'bank-imports' for `#import/bank`, else null. */
export function importTabFromHash(hash: string): 'bank-imports' | null {
  const [page, tab, ...rest] = hash.replace(/^#/, '').split('?')[0].split('/');
  return page === 'import' && tab === 'bank' && rest.length === 0 ? 'bank-imports' : null;
}
