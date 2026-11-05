/**
 * A file set aside takes its preview options with it. The bank summary goes from a file straight
 * to its import without the preview step that shows these options, so one kept from the first
 * file was applied to the next unseen: its date range dropped rows, its budget backfill wrote
 * budgets, its account types and tracking start date went to the next file's accounts.
 */
import { createRoot } from 'solid-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ImportFlow } from '../importFlow'

let flow: ImportFlow
let dispose: () => void

beforeAll(async () => {
  await import('../importFlow')
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  const { createImportFlow } = await import('../importFlow')
  createRoot((done) => {
    dispose = done
    flow = createImportFlow({ initialTab: 'file-upload', autoResetAfterImport: false })
  })
})

afterEach(() => {
  dispose()
})

describe('resetForm', () => {
  it('drops the date range the first file was imported with', () => {
    flow.setImportStartDate('2026-01-01')
    flow.setImportEndDate('2026-03-31')
    flow.resetForm()
    expect(flow.importStartDate()).toBe('')
    expect(flow.importEndDate()).toBe('')
  })

  it("turns off the first file's budgets from its spending", () => {
    flow.setSetBudgetsFromSpending(true)
    flow.resetForm()
    expect(flow.setBudgetsFromSpending()).toBe(false)
  })

  it("forgets the account types set for the first file's accounts", () => {
    flow.setAccountTypes({ Savings: 'savings' })
    flow.resetForm()
    expect(flow.accountTypes()).toEqual({})
  })

  it("forgets the first file's tracking start date", () => {
    flow.applyUniversalStartDate('2026-01-01')
    flow.resetForm()
    expect(flow.universalStartDate()).toBe('')
  })
})
