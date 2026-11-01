/**
 * A saved source (a connected Google Sheet) keeps the income/expense/account decision the user
 * made for each category. Applying it restores those decisions as they were saved: the keyword
 * classifier only guesses for a fresh mapping, so a change to its keywords never reclassifies a
 * source someone has already set up.
 */
import { createRoot } from 'solid-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import type { ImportFlow } from '../importFlow'

let flow: ImportFlow
let dispose: () => void

beforeAll(async () => {
  await Promise.all([import('../importFlow'), import('../../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  await db.add('accounts', {
    name: 'Checking',
    type: 'giro',
    balance: 0,
    starting_balance: 0,
    profile_id: 1,
  })
  const { createImportFlow } = await import('../importFlow')
  createRoot((done) => {
    dispose = done
    flow = createImportFlow({ initialTab: 'file-upload', autoResetAfterImport: false })
  })
})

afterEach(() => {
  dispose()
})

async function waitUntil(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const CSV = [
  'Date,Description,Amount,Category,Means of Payment',
  '2026-01-10,Books,-20,Library,Checking',
  '2026-01-11,Pay,1500,Salary,Checking',
].join('\n')

describe("a saved source's category types", () => {
  it('are restored as saved, even where the keyword guess differs', async () => {
    flow.handleFileSelect({
      target: { files: [new File([CSV], 'sheet.csv', { type: 'text/csv' })] },
    } as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await waitUntil(() => !flow.loading(), 'the upload')
    // The fresh guess, for contrast with what the user saved.
    expect(flow.categoryTypes()).toEqual({
      Library: 'expense',
      Salary: 'income',
      Checking: 'account',
    })

    flow.applySavedMapping(undefined, { Library: 'account', Salary: 'expense' })

    // The saved decisions as they were, plus the Means of Payment value as an account.
    expect(flow.categoryTypes()).toEqual({
      Library: 'account',
      Salary: 'expense',
      Checking: 'account',
    })
  })
})
