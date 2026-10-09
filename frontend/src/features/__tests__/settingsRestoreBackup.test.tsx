/**
 * Settings > Exports: a backup that is not restored says why in words a person can act on.
 *
 * The toast printed whatever the failure said, after "Backup restore failed: ": local-first's
 * check of the file in its own words ("Backup profiles must be an array"), and in the cloud the
 * Worker's refusal behind the same prefix. Now the Worker's refusal is said as it is (the cloud
 * adapter throws it as an ApiError), and anything else says what to check, through `plainMessage`
 * (frontend/src/__tests__/toastErrorMessages.test.ts, which held Settings at one such toast).
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../core/apiError'
import { confirmRequests, resolveConfirm } from '../../core/confirmStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setSettingsTab } from '../../core/settingsStore'
import { getDB } from '../../core/storage/idb'
import { getStorageAdapter, resetAdapter } from '../../core/storage/storageFactory'
import { removeToast, toasts } from '../../core/toastStore'

const RESTORE_FAILED =
  "Couldn't restore that backup. Check it's a backup file Token Circles saved. Your data is as it was."

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Settings'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  resetAdapter()
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  for (const toast of toasts()) removeToast(toast.id)
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  resetAdapter()
  vi.unstubAllGlobals()
})

const errorToasts = () =>
  toasts()
    .filter((t) => t.type === 'error')
    .map((t) => t.message)

describe('a backup that is not restored, in Settings', () => {
  it('says what to check, not what the check of the file said', async () => {
    setSettingsTab('exports')
    const { default: Settings } = await import('../Settings')
    dispose = render(() => <Settings />, host)
    const input = await vi.waitFor(() => {
      const found = host.querySelector<HTMLInputElement>('input[type="file"][accept*="json"]')
      expect(found).not.toBeNull()
      return found!
    })
    const file = new File([JSON.stringify({ profiles: 'not a list' })], 'backup.json', {
      type: 'application/json',
    })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))

    const request = await vi.waitFor(() => {
      const [open] = confirmRequests()
      expect(open).toBeDefined()
      return open!
    })
    resolveConfirm(request.id, true)

    await vi.waitFor(() => {
      expect(errorToasts()).toEqual([RESTORE_FAILED])
    })
    // Nothing was put back: the profile is as it was.
    expect(await (await getDB()).getAll('profiles')).toEqual([
      expect.objectContaining({ id: 1, name: 'Household' }),
    ])
  })
})

describe("the cloud's restore", () => {
  it("throws the Worker's refusal as an ApiError, in the Worker's words", async () => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    resetAdapter()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'A backup must contain at least one profile' }), {
            status: 422,
            headers: { 'content-type': 'application/json' },
          })
      )
    )
    const adapter = await getStorageAdapter()
    const refused = await adapter.importData({ profiles: [] } as never).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(ApiError)
    expect(refused).toMatchObject({
      status: 422,
      message: 'A backup must contain at least one profile',
    })
  })
})
