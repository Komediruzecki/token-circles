/**
 * How many transactions setup's first import says it adds ("Import 6"): the rows picked, less the
 * ones the import's dry run matches to transactions already stored, row by row.
 *
 * It used to subtract the dry run's count from the rows picked. A bank statement's repeat of its
 * own row is unpicked when the statement is read (shared/bankImport/process.ts), and the dry run
 * still matches it when the profile holds that charge twice, so the subtraction took it off twice
 * and said one fewer than the import adds.
 */
import { createRoot } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { createFirstImport } from '../FirstImport'

const fake = vi.hoisted(() => ({ flow: null as unknown }))
vi.mock('../../../features/import/importFlow', () => ({
  createImportFlow: () => fake.flow,
}))

/** The import flow after its preview: the rows picked, and the rows its dry run matched. */
function previewed(picked: number[], matched: number[]) {
  fake.flow = {
    selectedRows: () => new Set(picked),
    existingDuplicates: () => matched.length,
    existingDuplicateIndices: () => matched,
    bankFiles: () => [],
    loading: () => false,
  }
  return createRoot(() => createFirstImport({ preferredAccount: () => null, onImported: () => {} }))
}

describe('the count of what a first import adds', () => {
  it('leaves out each matched row once, and a repeat the statement left unpicked not again', () => {
    // Eight rows; the eighth repeats the seventh, so reading the statement unpicked it. The
    // profile holds that charge twice, so the dry run matched both rows.
    const importer = previewed([0, 1, 2, 3, 4, 5, 6], [6, 7])

    expect(importer.newCount()).toBe(6)
    expect(importer.alreadyHere()).toBe(2)
  })

  it('counts what the dry run did not match when part of the statement is here already', () => {
    const importer = previewed([0, 1, 2, 3, 4, 5, 6], [0, 1, 2])

    expect(importer.newCount()).toBe(4)
  })

  it('counts nothing when every row is here already', () => {
    const importer = previewed([0, 1, 2], [0, 1, 2])

    expect(importer.newCount()).toBe(0)
    expect(importer.alreadyHere()).toBe(3)
  })
})
