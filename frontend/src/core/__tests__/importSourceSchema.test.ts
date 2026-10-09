/**
 * shared/importSourceSchema.ts: what a connected source and a Google Sheet link may hold, in both
 * runtimes and the forms. Every rule and every message.
 */
import { describe, expect, it } from 'vitest'
import {
  checkImportSourceCreate,
  checkImportSourceEdit,
  checkSheetFetch,
  foreignSourceAccount,
  IMPORT_SOURCE_LABEL_MAX,
  IMPORT_SOURCE_MESSAGES as M,
  readSheetUrl,
} from '../../../../shared/importSourceSchema'

const SHEET = 'https://docs.google.com/spreadsheets/d/1AbC-d_9/edit#gid=42'
const fieldsOf = (checked: { ok: boolean; fields?: Record<string, string> }) =>
  checked.ok ? null : checked.fields

describe('the words', () => {
  it('say how to put each field right', () => {
    expect(M).toEqual({
      url: 'Paste the link to a Google Sheet. It starts with https://docs.google.com/spreadsheets/d/.',
      label: 'Give the source a name as text, or leave it blank.',
      labelLength: 'Keep the name to 200 characters or fewer.',
      kind: 'Choose google_sheet, google_drive_folder or bank_aggregator.',
      schedule: 'Choose manual, on_open or daily.',
      config:
        'Send the settings as an object, like {"url": "https://docs.google.com/spreadsheets/d/..."}.',
      account: 'Choose an account from the list, or leave it blank.',
      notFound: 'Source not found',
    })
    expect(IMPORT_SOURCE_LABEL_MAX).toBe(200)
    expect(foreignSourceAccount()).toEqual({ default_account_id: M.account })
  })
})

describe('a Google Sheet link', () => {
  it("reads the sheet's id and the tab's gid, trimmed", () => {
    expect(readSheetUrl(`  ${SHEET} `)).toEqual({
      value: { url: SHEET, id: '1AbC-d_9', gid: '42' },
    })
    expect(readSheetUrl('https://docs.google.com/spreadsheets/d/abc/edit')).toEqual({
      value: { url: 'https://docs.google.com/spreadsheets/d/abc/edit', id: 'abc', gid: null },
    })
  })

  it('needs /d/ and an id', () => {
    for (const raw of [undefined, null, '', '   ', 12, 'abc', 'https://example.com/not-a-sheet']) {
      expect(readSheetUrl(raw)).toEqual({ error: M.url })
    }
  })

  it('is fetched with the tab asked for, or none', () => {
    expect(checkSheetFetch({ url: SHEET, sheetName: 'March' })).toEqual({
      ok: true,
      value: { url: SHEET, id: '1AbC-d_9', gid: '42', sheetName: 'March' },
    })
    expect(checkSheetFetch({ url: SHEET, sheetName: 3 })).toMatchObject({
      value: { sheetName: '' },
    })
    expect(fieldsOf(checkSheetFetch({ url: 'nope' }))).toEqual({ url: M.url })
    expect(fieldsOf(checkSheetFetch(null))).toEqual({ url: M.url })
  })
})

describe('a new source', () => {
  it('is a manual Google Sheet by default, its name trimmed', () => {
    expect(checkImportSourceCreate({ label: '  Ledger ', config: { url: SHEET } })).toEqual({
      ok: true,
      value: { kind: 'google_sheet', label: 'Ledger', config: { url: SHEET }, schedule: 'manual' },
    })
  })

  it('keeps the mapping, the category types, the account and the stamps it is given', () => {
    expect(
      checkImportSourceCreate({
        config: { url: SHEET, sheetName: 'Sheet1' },
        mapping: { date: 'Date' },
        category_types: 'nope',
        default_account_id: '7',
        last_synced_at: '2026-10-08T09:30:00.000Z',
        last_cursor: 4,
      })
    ).toMatchObject({
      ok: true,
      value: {
        mapping: { date: 'Date' },
        category_types: null,
        default_account_id: 7,
        last_synced_at: '2026-10-08T09:30:00.000Z',
        last_cursor: null,
      },
    })
    expect(
      checkImportSourceCreate({ config: { url: SHEET }, default_account_id: null })
    ).toMatchObject({ value: { default_account_id: null } })
  })

  it('needs a kind and a schedule there is such a thing as', () => {
    expect(
      fieldsOf(checkImportSourceCreate({ kind: 'dropbox', schedule: 'hourly', config: {} }))
    ).toEqual({ kind: M.kind, schedule: M.schedule })
    expect(
      checkImportSourceCreate({ kind: 'bank_aggregator', schedule: 'daily', config: {} })
    ).toMatchObject({ ok: true, value: { kind: 'bank_aggregator', schedule: 'daily' } })
  })

  it('needs a name that is text, of 200 characters or fewer', () => {
    const base = { config: { url: SHEET } }
    expect(fieldsOf(checkImportSourceCreate({ ...base, label: 42 }))).toEqual({ label: M.label })
    expect(fieldsOf(checkImportSourceCreate({ ...base, label: 'x'.repeat(201) }))).toEqual({
      label: M.labelLength,
    })
    expect(checkImportSourceCreate({ ...base, label: ` ${'x'.repeat(200)} ` })).toMatchObject({
      ok: true,
    })
    expect(checkImportSourceCreate({ ...base, label: null })).toMatchObject({
      value: { label: '' },
    })
  })

  it("needs settings that are an object, and a sheet's to carry its link", () => {
    expect(fieldsOf(checkImportSourceCreate({ config: 'sheet' }))).toEqual({ config: M.config })
    expect(fieldsOf(checkImportSourceCreate({ config: [] }))).toEqual({ config: M.config })
    expect(fieldsOf(checkImportSourceCreate({}))).toEqual({ 'config.url': M.url })
    expect(fieldsOf(checkImportSourceCreate({ config: { url: 'nope' } }))).toEqual({
      'config.url': M.url,
    })
    expect(checkImportSourceCreate({ config: { url: ` ${SHEET}` } })).toMatchObject({
      value: { config: { url: SHEET } },
    })
  })

  it('needs a default account given by its id', () => {
    expect(
      fieldsOf(checkImportSourceCreate({ config: { url: SHEET }, default_account_id: 'Everyday' }))
    ).toEqual({ default_account_id: M.account })
  })
})

describe('an edit of a source', () => {
  const stored = { kind: 'google_sheet' }

  it('checks only the fields it sends', () => {
    expect(checkImportSourceEdit({ label: 'Renamed' }, stored)).toEqual({
      ok: true,
      value: { label: 'Renamed' },
    })
    expect(checkImportSourceEdit({ last_synced_at: '2026-10-08' }, stored)).toEqual({
      ok: true,
      value: { last_synced_at: '2026-10-08' },
    })
  })

  it("checks a sheet's new settings for the link, by the kind the source keeps", () => {
    expect(fieldsOf(checkImportSourceEdit({ config: { sheetName: 'B' } }, stored))).toEqual({
      'config.url': M.url,
    })
    expect(
      checkImportSourceEdit({ config: { sheetName: 'B' } }, { kind: 'google_drive_folder' })
    ).toMatchObject({ ok: true })
  })

  it('refuses a kind, a schedule or an account it sends that cannot be stored', () => {
    expect(
      fieldsOf(
        checkImportSourceEdit({ kind: 'x', schedule: 'weekly', default_account_id: 0 }, stored)
      )
    ).toEqual({ kind: M.kind, schedule: M.schedule, default_account_id: M.account })
  })
})
