/**
 * A value the mapping step marks as an account (a transfer's destination, or a name
 * classifyCategory reads as one, like "Savings") is still the category of a row paid from another
 * account. The preview offered it as a category to create and then dropped it on the page, so when
 * any other category was new the run was gated, it was not approved, and the row imported with no
 * category. The page now offers what the importer offers, through the real local-first router.
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
  for (const name of ['Checking', 'Vacation']) {
    await db.add('accounts', { name, type: 'giro', balance: 0, starting_balance: 0, profile_id: 1 })
  }
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
  'Date,Description,Amount,Category,Means of Payment,Type',
  '2026-01-10,Travel Agent,-80,Vacation,Checking,Expense',
  '2026-01-11,Coffee,-3,Cafes,Checking,Expense',
  '2026-01-13,Save,200,Vacation,Checking,Transfer',
].join('\n')

describe('a value marked as an account, used as a category on a row paid from another', () => {
  it('is offered as a category to create, and the row imports in it', async () => {
    flow.handleFileSelect({
      target: { files: [new File([CSV], 'sheet.csv', { type: 'text/csv' })] },
    } as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await waitUntil(() => !flow.loading(), 'the upload')
    expect(flow.categoryTypes()).toMatchObject({ Vacation: 'account' })

    await flow.goToPreview()
    expect([...flow.newCategories()].sort()).toEqual(['Cafes', 'Vacation'])
    await flow.handleImport('all')
    await waitUntil(() => !flow.loading(), 'the import')
    expect(flow.error()).toBeNull()

    const db = await getDB()
    const categories = new Map(
      ((await db.getAll('categories')) as { id: number; name: string }[]).map((c) => [c.id, c.name])
    )
    const expense = (
      (await db.getAll('transactions')) as {
        description: string
        category_id?: number
      }[]
    ).find((t) => t.description === 'Travel Agent')
    expect(categories.get(expense?.category_id ?? -1)).toBe('Vacation')
  })
})
