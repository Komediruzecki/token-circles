/**
 * The Import page's Paste CSV tab on the form kit (pasteForm.ts), with the real import flow in
 * local-first mode.
 *
 * Its button stayed disabled until something was pasted, with nothing to say why, and a paste of
 * one line was "Need at least a header row and one data row" in the banner at the top of the page.
 * Now an empty paste, or one with no row of data under its header, is marked under the box, focus
 * moves to it, and nothing is parsed.
 */
import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import { checkPaste, PASTE_MESSAGES } from '../pasteForm'
import type { ImportFlow } from '../importFlow'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([
    import('../ImportDataEntry'),
    import('../importFlow'),
    import('../../../core/storage/localApiRouter'),
  ])
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
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

async function openPaste(): Promise<ImportFlow> {
  setPage('import')
  const { ImportDataEntry } = await import('../ImportDataEntry')
  const { createImportFlow } = await import('../importFlow')
  let flow!: ImportFlow
  dispose = createRoot((disposeRoot) => {
    flow = createImportFlow({ initialTab: 'paste-csv' })
    const unmount = render(() => <ImportDataEntry flow={flow} />, host)
    return () => {
      unmount()
      disposeRoot()
    }
  })
  await vi.waitFor(() => {
    expect(box()).not.toBeNull()
  })
  return flow
}

const box = () => host.querySelector<HTMLTextAreaElement>('[data-test-id="import-paste-textarea"]')!
const parse = () => host.querySelector<HTMLButtonElement>('[data-test-id="import-paste-parse"]')!
const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

function paste(text: string): void {
  box().value = text
  box().dispatchEvent(new InputEvent('input', { bubbles: true }))
}

describe('the check', () => {
  it('wants a header row and a row of data under it', () => {
    expect(checkPaste({ text: 'date,amount\n2026-08-01,-5' })).toEqual({})
    expect(checkPaste({ text: 'date\tamount\r\n\r\n2026-08-01\t-5\r\n' })).toEqual({})
    for (const text of ['', '   ', 'date,amount', 'date,amount\n,,\n  ', '\n\n,,']) {
      expect(checkPaste({ text })).toEqual({ text: PASTE_MESSAGES.text })
    }
  })
})

describe('Paste CSV', () => {
  it('labels the box and the separator', async () => {
    await openPaste()
    expect(host.querySelector(`label[for="${box().id}"]`)?.textContent).toBe('Pasted rows')
    const separator = host.querySelector('select')!
    expect(host.querySelector(`label[for="${separator.id}"]`)?.textContent).toBe(
      'Columns separated by'
    )
  })

  it('marks an empty paste, or one with no row of data, focuses the box, and parses nothing', async () => {
    const flow = await openPaste()
    for (const text of ['', 'date,description,amount']) {
      paste(text)
      parse().click()
      await vi.waitFor(() => {
        expect(box().getAttribute('aria-invalid')).toBe('true')
      })
      expect(describedBy(box())).toContain(PASTE_MESSAGES.text)
      expect(document.activeElement).toBe(box())
    }
    expect(flow.uploadResult()).toBeNull()
    expect(flow.error()).toBeNull()
  })

  it('parses a paste with a row of data, ready for the mapping step', async () => {
    const flow = await openPaste()
    paste('date,description,amount\n2026-08-01,Coffee,-5.00\n2026-08-02,Lunch,-12.40')
    parse().click()
    await vi.waitFor(() => {
      expect(flow.uploadResult()).not.toBeNull()
    })
    expect(flow.uploadResult()).toMatchObject({
      headers: ['date', 'description', 'amount'],
      totalRows: 2,
    })
    expect(box().getAttribute('aria-invalid')).toBeNull()
    expect(host.querySelector('[data-test-id="import-continue-mapping"]')).not.toBeNull()
  })

  it('keeps the paste in the flow as it is typed', async () => {
    const flow = await openPaste()
    paste('date,amount')
    expect(flow.pastedText()).toBe('date,amount')
  })
})
