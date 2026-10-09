/**
 * The Import page's File Upload on the form kit (uploadForm.ts), with the real import flow and the
 * real local-first router, which reads the file with the Worker's reader (shared/importUpload.ts).
 *
 * A file that was not read was said in the banner at the top of the page, away from the drop area,
 * and a file over the size cap went up before either runtime refused it. Now the size is checked
 * before anything is sent, a file the runtime refuses is marked under the drop area in the
 * runtime's words, and focus moves to the file input, which a keyboard can now reach.
 */
import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORT_UPLOAD_MESSAGES as M } from '../../../../../shared/importUpload'
import { setPage } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import type { apiFetch as ApiFetch } from '../../../core/apiFetch'
import type { ImportFlow } from '../importFlow'

const net = vi.hoisted(() => ({ uploads: 0 }))

vi.mock('../../../core/apiFetch', async (importOriginal) => {
  const real = await importOriginal<{ apiFetch: typeof ApiFetch }>()
  return {
    ...real,
    apiFetch: async (url: string, init: RequestInit = {}) => {
      if (url === '/api/import/upload') net.uploads++
      return real.apiFetch(url, init)
    },
  }
})

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
  net.uploads = 0
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

async function openUpload(): Promise<ImportFlow> {
  setPage('import')
  const { ImportDataEntry } = await import('../ImportDataEntry')
  const { createImportFlow } = await import('../importFlow')
  let flow!: ImportFlow
  dispose = createRoot((disposeRoot) => {
    flow = createImportFlow({ initialTab: 'file-upload' })
    const unmount = render(() => <ImportDataEntry flow={flow} />, host)
    return () => {
      unmount()
      disposeRoot()
    }
  })
  await vi.waitFor(() => {
    expect(input()).not.toBeNull()
  })
  return flow
}

const input = () => host.querySelector<HTMLInputElement>('[data-test-id="import-file-input"]')!
const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

function choose(file: File): void {
  Object.defineProperty(input(), 'files', { value: [file], configurable: true })
  input().dispatchEvent(new Event('change', { bubbles: true }))
}

describe('File Upload', () => {
  it('labels the file input', async () => {
    await openUpload()
    const names = Array.from(host.querySelectorAll(`label[for="${input().id}"]`)).map(
      (label) => label.textContent
    )
    expect(names[0]).toBe('File to import')
  })

  it('marks a file the runtime cannot read under the drop area, focused, not in the banner', async () => {
    const flow = await openUpload()
    // A zip's first bytes and nothing after: a workbook neither runtime can open.
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0])
    choose(new File([broken], 'ledger.xlsx', { type: 'application/octet-stream' }))

    await vi.waitFor(() => {
      expect(input().getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(input())).toContain(M.unreadable)
    expect(document.activeElement).toBe(input())
    expect(flow.error()).toBeNull()
    expect(flow.activeStep()).toBe('upload')
    expect(net.uploads).toBe(1)
  })

  it('marks a file over the size cap, and sends nothing', async () => {
    await openUpload()
    choose(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.csv', { type: 'text/csv' }))

    await vi.waitFor(() => {
      expect(input().getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(input())).toContain(M.tooLarge)
    expect(net.uploads).toBe(0)
  })

  it('reads a file it can, and goes on to the mapping step with its columns', async () => {
    const flow = await openUpload()
    choose(
      new File(['date,description,amount\n2026-08-01,Coffee,-5.00\n'], 'ledger.csv', {
        type: 'text/csv',
      })
    )
    await vi.waitFor(() => {
      expect(flow.activeStep()).toBe('mapping')
    })
    expect(flow.currentHeaders()).toEqual(['date', 'description', 'amount'])
    expect(input().value).toBe('')
  })
})
