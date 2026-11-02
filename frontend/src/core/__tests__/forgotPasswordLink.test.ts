/**
 * `#forgot-password`, the Reset password button of the "already has an account" mail, read before
 * the app mounts. The sign-in screen opens on the reset form, and only account mode has a sign-in
 * screen, so a browser that never chose account mode (production's default is local-first) moves
 * to it, as a confirm link does. The data kept on the device stays where it is.
 */
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  return import('../forgotPasswordLink')
}

const PROBE_DB = 'finance-manager-forgot-probe'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.resetModules()
})

describe('consumeForgotPasswordLink', () => {
  it('moves a fresh browser, which starts local-first, to account mode', async () => {
    // frontend/.env, which the tests read, sets VITE_DEFAULT_STORAGE=dexie, as production does.
    history.replaceState(null, '', '/#forgot-password')
    const { consumeForgotPasswordLink } = await load()
    const { getStorageMode } = await import('../storage/storageFactory')
    expect(getStorageMode()).toBe('serverless')

    consumeForgotPasswordLink()

    expect(localStorage.getItem('finance_storage_mode')).toBe('self-hosted')
  })

  it('moves a browser that chose local-first to account mode too', async () => {
    localStorage.setItem('finance_storage_mode', 'serverless')
    history.replaceState(null, '', '/#forgot-password')
    const { consumeForgotPasswordLink } = await load()

    consumeForgotPasswordLink()

    expect(localStorage.getItem('finance_storage_mode')).toBe('self-hosted')
  })

  it('leaves the fragment for the sign-in screen, which opens on the reset form from it', async () => {
    history.replaceState(null, '', '/?x=1#forgot-password')
    const { consumeForgotPasswordLink } = await load()

    consumeForgotPasswordLink()

    expect(window.location.hash).toBe('#forgot-password')
    expect(window.location.search).toBe('?x=1')
  })

  it("leaves the device's local data where it is", async () => {
    localStorage.setItem('finance_storage_mode', 'serverless')
    const db = await openDB(PROBE_DB, 1, {
      upgrade: (upgrading) => {
        upgrading.createObjectStore('kept')
      },
    })
    await db.put('kept', 'groceries', 'entry')
    db.close()
    const deleteDatabase = vi.spyOn(window.indexedDB, 'deleteDatabase')
    history.replaceState(null, '', '/#forgot-password')
    const { consumeForgotPasswordLink } = await load()

    consumeForgotPasswordLink()

    expect(deleteDatabase).not.toHaveBeenCalled()
    const reopened = await openDB(PROBE_DB, 1)
    expect(await reopened.get('kept', 'entry')).toBe('groceries')
    reopened.close()
    deleteDatabase.mockRestore()
  })

  for (const hash of [
    '',
    '#budgets',
    '#reset-password?token=abc',
    '#everified=1',
    '#forgot-passwords',
  ]) {
    it(`leaves the mode alone for ${hash === '' ? 'no fragment' : hash}`, async () => {
      localStorage.setItem('finance_storage_mode', 'serverless')
      history.replaceState(null, '', `/${hash}`)
      const { consumeForgotPasswordLink } = await load()

      consumeForgotPasswordLink()

      expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')
    })
  }
})
