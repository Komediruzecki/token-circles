/**
 * The edges of keeping a Google Sheet (review of 19 Nov, finding 11): a published link is its
 * own sheet, a link with no gid is its first tab, and a sheet whose tab has no known name is not
 * given one. Made-up sheet ids only.
 */
import { describe, expect, it } from 'vitest'
import { keepSheetBody, sourceForSheet } from '../keepSheet'
import type { ImportSource } from '../../../core/importSources'

const saved = (id: number, url: string): ImportSource => ({
  id,
  profile_id: 1,
  kind: 'google_sheet',
  label: `Example ${id}`,
  config: { url },
  schedule: 'manual',
})

describe('the saved source for a sheet', () => {
  it('tells two published sheets apart by their own ids', () => {
    const first = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vExampleFirstSheet/pubhtml'
    const second =
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vExampleSecondSheet/pub?output=csv'
    const sources = [saved(1, first)]

    expect(sourceForSheet(sources, second)).toBeNull()
    expect(sourceForSheet(sources, `${first}?gid=0`)?.id).toBe(1)
  })

  it('takes a link with no gid as the tab with gid 0, and no other', () => {
    const sources = [saved(1, 'https://docs.google.com/spreadsheets/d/example-sheet-id/edit#gid=0')]

    expect(
      sourceForSheet(sources, 'https://docs.google.com/spreadsheets/d/example-sheet-id/edit')?.id
    ).toBe(1)
    expect(
      sourceForSheet(sources, 'https://docs.google.com/spreadsheets/d/example-sheet-id/edit#gid=7')
    ).toBeNull()
  })
})

describe('a sheet kept with no tab name', () => {
  it('is named for what it is, with no tab name made up', () => {
    const url = 'https://docs.google.com/spreadsheets/d/example-sheet-id/edit#gid=0'
    const body = keepSheetBody(
      { url, sheetName: '', mapping: {}, categoryTypes: {} },
      '',
      '2026-11-19T10:00:00.000Z'
    )

    expect(body.label).toBe('Google Sheet')
    expect(body.config).toEqual({ url })
  })
})
