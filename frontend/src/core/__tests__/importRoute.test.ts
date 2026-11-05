/**
 * The Import page's address for its Bank Imports tab (review M4): the day-2 mail promises files
 * from the banks the app knows import as they are, and its "Import statements" opened the Google
 * Sheets tab. The mail and Getting started open `#import/bank`; `#import` keeps opening the page
 * on its own first tab.
 */
import { describe, expect, it } from 'vitest'
import { BANK_IMPORT_HASH, importTabFromHash } from '../../../../shared/importRoute'

describe('the Bank Imports address', () => {
  it('is #import/bank', () => {
    expect(BANK_IMPORT_HASH).toBe('#import/bank')
  })

  it('names the Bank Imports tab, with or without its # and a query', () => {
    expect(importTabFromHash('#import/bank')).toBe('bank-imports')
    expect(importTabFromHash('import/bank')).toBe('bank-imports')
    expect(importTabFromHash('#import/bank?period=2026-10')).toBe('bank-imports')
  })

  it('names no tab for the page itself, another path or another page', () => {
    expect(importTabFromHash('#import')).toBeNull()
    expect(importTabFromHash('#import?period=2026-10')).toBeNull()
    expect(importTabFromHash('#import/banks')).toBeNull()
    expect(importTabFromHash('#import/bank/2')).toBeNull()
    expect(importTabFromHash('#progress/bank')).toBeNull()
    expect(importTabFromHash('')).toBeNull()
  })
})
