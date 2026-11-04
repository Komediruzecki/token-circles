/**
 * The welcome and the day-2 mail name the banks whose files import as they are. They name each one
 * as the importer lists it (each adapter's label in shared/bankImport), so a reader who looks for
 * the bank on the Import page finds the name the mail gave: "ING NL", where the mails said "ING"
 * (review M19). YNAB is not in the list: the welcome gives its file a sentence of its own.
 */
import { describe, expect, it } from 'vitest';
import { listAdapters } from '../../shared/bankImport';
import { renderWeekOneDay2, renderWelcome } from '../src/emailTemplates';

/** The banks the importer reads as they are, as it labels them. */
const IMPORTER = listAdapters()
  .filter((adapter) => adapter.id !== 'ynab')
  .map((adapter) => adapter.label)
  .sort();

/** The banks a mail's text names, from its one sentence that lists them. */
function banksNamed(text: string): string[] {
  const list = /(?:Statements|Files) from ([^.]+) import as they are\./.exec(
    text.replace(/\s+/g, ' ')
  )?.[1];
  expect(list, 'a sentence that lists the banks').toBeDefined();
  return list!.split(/, | and /).sort();
}

describe('the banks the mails name', () => {
  const mails = [
    ['welcome', renderWelcome()],
    ['week-one-day-2', renderWeekOneDay2()],
  ] as const;

  for (const [name, mail] of mails) {
    it(`${name} names every bank the importer reads, as the importer names it`, () => {
      expect(IMPORTER).toContain('ING NL');
      expect(banksNamed(mail.text)).toEqual(IMPORTER);
      for (const bank of IMPORTER) expect(mail.html).toContain(bank);
    });
  }
});
