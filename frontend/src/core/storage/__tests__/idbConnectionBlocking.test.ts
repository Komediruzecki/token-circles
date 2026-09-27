/**
 * The local database gives way to another tab, and says when it waits for one.
 *
 * An upgrade to a new database version cannot start while another tab holds a connection at the
 * old version, and a reset cannot delete the database while one is open. The connection had no
 * handler for either side: the waiting tab hung with nothing on screen, and the tab in the way
 * never let go.
 */
import { forceCloseDatabase } from 'fake-indexeddb'
import { deleteDB, openDB, unwrap } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createV12Schema } from './v12Schema'
import type { IDBPDatabase } from 'idb'

const reloadToLatest = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@pwa-kit', () => ({ reloadToLatest }))

const DB_NAME = 'finance-manager'
const UPDATE_CHANNEL = 'app-update'
const BLOCKED_CHANNEL = 'db-upgrade-blocked'

/** Every connection a test opened, closed after it so the next one starts from nothing. */
let opened: Array<IDBPDatabase | IDBDatabase> = []

/** A fresh copy of the modules holding the connection and the toasts, as a newly loaded tab has. */
async function loadTab() {
  vi.resetModules()
  const { getDB } = await import('../idb.js')
  const { toasts, removeToastsByChannel } = await import('../../toastStore')
  const notice = (channel: string) => toasts().find((t) => t.channel === channel)
  return { getDB, notice, removeToastsByChannel }
}

/** What `promise` did within `ms`: settled, or still waiting. */
function within<T>(promise: Promise<T>, ms = 300): Promise<'settled' | 'waiting'> {
  return Promise.race([
    promise.then(
      () => 'settled' as const,
      () => 'settled' as const
    ),
    new Promise<'waiting'>((resolve) => {
      setTimeout(() => {
        resolve('waiting')
      }, ms)
    }),
  ])
}

/** Another tab opening the database at `version`, as a newer build would. */
function openInAnotherTab(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, version)
    request.onsuccess = () => {
      opened.push(request.result)
      resolve(request.result)
    }
    request.onerror = () => {
      reject(new Error(request.error?.message ?? 'The other tab could not open the database'))
    }
  })
}

beforeEach(async () => {
  reloadToLatest.mockClear()
  await deleteDB(DB_NAME)
})

afterEach(() => {
  for (const db of opened) db.close()
  opened = []
})

describe('another tab opening a newer build', () => {
  it('gets the database: this tab closes its connection and asks to be reloaded', async () => {
    const tab = await loadTab()
    opened.push(await tab.getDB())

    expect(await within(openInAnotherTab(14))).toBe('settled')

    const notice = tab.notice(UPDATE_CHANNEL)
    expect(notice?.message).toBe(
      'A newer Token Circles is open in another tab. Reload this tab to keep working.'
    )
    expect(notice?.title).toBe('Update')
    expect(notice?.action?.label).toBe('Reload')
    notice!.action!.onClick()
    expect(reloadToLatest).toHaveBeenCalledTimes(1)
  })

  it('leaves later reads and writes waiting, and raises the notice again once it expired', async () => {
    const tab = await loadTab()
    opened.push(await tab.getDB())
    await openInAnotherTab(14)

    // A failure would reach the pages as empty lists, which read as lost data.
    expect(await within(tab.getDB(), 50)).toBe('waiting')

    tab.removeToastsByChannel(UPDATE_CHANNEL)
    void tab.getDB()
    expect(tab.notice(UPDATE_CHANNEL)?.action?.label).toBe('Reload')
  })
})

describe('a reset deleting the database', () => {
  it('is not held up by this tab, which asks to be reloaded', async () => {
    const tab = await loadTab()
    opened.push(await tab.getDB())

    expect(await within(deleteDB(DB_NAME))).toBe('settled')

    const notice = tab.notice(UPDATE_CHANNEL)
    expect(notice?.message).toBe('Token Circles data was reset. Reload this tab to keep working.')
    expect(notice?.action?.label).toBe('Reload')
  })
})

describe('an older tab holding the database open', () => {
  it('holds this tab’s upgrade: it says so, and stops saying so once the upgrade runs', async () => {
    // A tab on the previous build holds the database at v12 and, like every build before this
    // one, never lets go on its own.
    const olderTab = await openDB(DB_NAME, 12, { upgrade: createV12Schema })
    opened.push(olderTab)

    const tab = await loadTab()
    const opening = tab.getDB()
    await vi.waitFor(() => {
      expect(tab.notice(BLOCKED_CHANNEL)?.message).toBe(
        'Close your other Token Circles tabs to finish updating this one.'
      )
    })
    expect(await within(opening, 50)).toBe('waiting')

    olderTab.close()
    const db = await opening
    opened.push(db)

    expect(db.version).toBe(13)
    expect(tab.notice(BLOCKED_CHANNEL)).toBeUndefined()
  })
})

describe('a connection the browser closes by itself', () => {
  it('is replaced by a new one on the next call, not reused dead', async () => {
    const tab = await loadTab()
    const first = await tab.getDB()
    opened.push(first)

    forceCloseDatabase(unwrap(first) as never)

    const second = await tab.getDB()
    opened.push(second)
    expect(second).not.toBe(first)
    await expect(second.getAll('profiles')).resolves.toEqual([])
  })
})
