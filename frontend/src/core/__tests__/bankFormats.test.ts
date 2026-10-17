/**
 * The bank formats an import log keeps (shared/bankFormats.ts, migration 0038), and the ones the
 * import page sends (`importedBankFormats` in features/import/importFlow.ts).
 *
 * Which formats a profile's statements came in is a hint to where the person lives. Every writer
 * keeps only the ids the app reads, so a later build's adapter or a client's guess never reaches
 * the column.
 */
import { describe, expect, it } from 'vitest'
import {
  BANK_FORMAT_IDS,
  bankFormatsOf,
  isBankFormat,
  storedBankFormats,
} from '../../../../shared/bankFormats'
import { listAdapters } from '../../../../shared/bankImport'
import { importedBankFormats } from '../../features/import/importFlow'

describe('the bank formats a log keeps', () => {
  it('are the formats the import reads, every one of them', () => {
    expect([...BANK_FORMAT_IDS]).toEqual(listAdapters().map((adapter) => adapter.id))
  })

  it('are stored as the known ids, lowercased, each once, in the order given', () => {
    expect(storedBankFormats(['dkb', ' Sparkasse ', 'dkb'])).toBe('dkb,sparkasse')
    expect(storedBankFormats('erste, PBZ')).toBe('erste,pbz')
    expect(storedBankFormats(['n26'])).toBe('n26')
  })

  it('drop an id the app does not read, and store none as null', () => {
    expect(storedBankFormats(['mybank', 'dkb', 'constructor'])).toBe('dkb')
    expect(storedBankFormats(['mybank'])).toBeNull()
    expect(storedBankFormats([])).toBeNull()
    expect(storedBankFormats('')).toBeNull()
    expect(storedBankFormats(null)).toBeNull()
    expect(storedBankFormats(undefined)).toBeNull()
    expect(storedBankFormats(7)).toBeNull()
    expect(storedBankFormats([7, { id: 'dkb' }])).toBeNull()
  })

  it('are read back as the known ids a stored value names', () => {
    expect(bankFormatsOf('dkb,sparkasse')).toEqual(['dkb', 'sparkasse'])
    expect(bankFormatsOf('dkb,mybank')).toEqual(['dkb'])
    expect(bankFormatsOf(null)).toEqual([])
    expect(isBankFormat('ing')).toBe(true)
    expect(isBankFormat('ING')).toBe(false)
  })
})

describe('the bank formats the import page sends', () => {
  const row = (bankId: string | null) =>
    ({ bankId }) as Parameters<typeof importedBankFormats>[1][number]

  it("are the recognised statements' formats, each once, from the Bank Imports tab", () => {
    expect(
      importedBankFormats('bank-imports', [row('dkb'), row(null), row('dkb'), row('ing')])
    ).toEqual(['dkb', 'ing'])
  })

  it('are none from a tab that reads a plain table', () => {
    for (const tab of ['file-upload', 'google-sheets', 'paste']) {
      expect(importedBankFormats(tab, [row('dkb')]), tab).toEqual([])
    }
  })
})
