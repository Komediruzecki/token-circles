/**
 * The Import page's flow after an import (review of the setup captures, 19 Nov): the page's card
 * says what came in, and the flow went back to its first step three seconds later. For those three
 * seconds the preview stayed with Import selected and Import all live, inviting the same rows in
 * again.
 */
import { createRoot } from 'solid-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import type { ImportFlow, ImportSummary } from '../importFlow'

let flow: ImportFlow
let dispose: () => void
let landed: ImportSummary[] = []

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
  landed = []
  const { createImportFlow } = await import('../importFlow')
  createRoot((done) => {
    dispose = done
    // As the Import page makes it: the flow starts over by itself after an import.
    flow = createImportFlow({
      initialTab: 'file-upload',
      onImported: (summary) => landed.push(summary),
    })
  })
})

afterEach(() => {
  dispose()
})

async function settled(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (!flow.loading()) return
  }
  throw new Error('timed out waiting for the flow')
}

describe('the Import page after an import', () => {
  it('starts over as soon as the rows are in, so no preview is left to import again', async () => {
    await flow.readFile(
      new File(['Date,Description,Amount\n2026-03-01,Example bakery,-4.20\n'], 'statement.csv', {
        type: 'text/csv',
      })
    )
    await settled()
    await flow.goToPreview()
    expect(flow.activeStep()).toBe('preview')

    await flow.handleImport('all')

    expect(landed.map((one) => one.imported)).toEqual([1])
    expect(flow.activeStep()).toBe('upload')
  })
})
