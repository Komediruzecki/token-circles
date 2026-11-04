/**
 * Older UI strings that predate the product-voice rules, rewritten (first-week test run, B9 and
 * the design review's M22): each said its second half after an em dash, and two told a mouse user
 * to tap.
 *
 * Each case reads the file the string lives in, with JSX line breaks collapsed to single spaces as
 * the browser shows them, and checks that the new wording is there and the old is gone. The two
 * strings with a rendered test of their own are checked there too: the prints readout in
 * printsShelf.test.tsx, and the transfer note in core/bankImport/__tests__/bankImport.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

/** The file as the page reads it: every run of whitespace one space. */
const read = (path: string): string => readFileSync(join(SRC, path), 'utf8').replace(/\s+/g, ' ')

const REWRITES: { where: string; file: string; old: string; now: string }[] = [
  {
    where: 'the subscription scan offer after an import',
    file: 'features/Import.tsx',
    old: 'transactions imported — want to check them for known subscriptions',
    now: '{scanOfferCount()} transactions imported. Want to check them for subscriptions like Netflix or Spotify?',
  },
  {
    where: 'a line in Recent Imports',
    file: 'features/Import.tsx',
    old: '{new Date(log.created_at).toLocaleString()} — {log.imported} imported',
    now: '{new Date(log.created_at).toLocaleString()} · {log.imported} imported',
  },
  {
    where: 'the Paste CSV tab',
    file: 'features/import/ImportDataEntry.tsx',
    old: "any spreadsheet app — it's parsed right in your browser.",
    now: "Paste a table straight from Excel, Google Sheets or any spreadsheet app. It's read right here in your browser.",
  },
  {
    where: 'the Dashboard holdings panel with none',
    file: 'components/Dashboard/OverviewDeck.tsx',
    old: 'No holdings yet — add one on the Portfolio page.',
    now: 'No holdings yet. Add one on the Portfolio page.',
  },
  {
    where: 'the preview date range',
    file: 'features/import/ImportPreviewStep.tsx',
    old: 'Only import transactions within this period — rows outside it are skipped.',
    now: 'Rows outside this period are skipped. Leave a side blank for no bound.',
  },
  {
    where: 'the preview new categories',
    file: 'features/import/ImportPreviewStep.tsx',
    old: "Uncheck any you don't want created — rows with an unchecked category import without a category.",
    now: "These category values don't match an existing category. Untick any you don't want created. Their rows import without a category.",
  },
  {
    where: 'Settings in Local mode',
    file: 'features/Settings.tsx',
    old: 'Running in Local mode — data stays in this browser, fully offline.',
    now: 'Local mode: your data stays in this browser and works offline.',
  },
  {
    where: 'the note on a bank row read as a transfer to an unknown account',
    file: '../../shared/bankImport/classify.ts',
    old: 'possible transfer — counterpart not resolved',
    now: "Possible transfer: the other account wasn't found.",
  },
  {
    where: 'the prints readout before a petal is chosen',
    file: 'core/prints/copy.ts',
    old: 'Tap a petal to see its month.',
    now: 'Choose a petal to see its month.',
  },
  {
    where: 'the subscription catalog',
    file: 'components/SubscriptionCatalogModal.tsx',
    old: 'Tap the ones you have',
    now: 'Pick the ones you have · choose a plan or type your price',
  },
]

describe('older UI strings, rewritten', () => {
  it.each(REWRITES)('$where', ({ file, old, now }) => {
    const source = read(file)
    expect(source).toContain(now)
    expect(source).not.toContain(old)
    expect(now).not.toMatch(/—/)
  })
})
