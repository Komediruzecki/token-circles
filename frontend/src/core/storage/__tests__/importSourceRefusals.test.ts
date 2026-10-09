/**
 * What local-first's connected sources and Google Sheet link refuse, and how they say it: the
 * twin of worker/test/import-source-refusals.test.ts, by the same rules
 * (shared/importSourceSchema.ts), through `routeApiRequest`, with an older source in place.
 *
 * Before, a kind or a schedule there is no such thing as was "Invalid kind" or "Invalid schedule",
 * naming no field; a long name was cut to 200 characters, and a name or settings that were not
 * text or an object were stored empty, without a word; another profile's account was taken as the
 * default account; a sheet was saved with no link to fetch; and a link that was not a sheet's was
 * "Invalid Google Sheets URL or ID", or "URL is required", at no field.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IMPORT_SOURCE_MESSAGES as M } from '../../../../../shared/importSourceSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const PROFILE = 1
const SIDE = 2
const MINE = 10
const THEIRS = 11
const OLD_SOURCE = 20
const SHEET = 'https://docs.google.com/spreadsheets/d/source-sheet/edit#gid=0'

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', String(PROFILE))
  localStorage.setItem('selectedProfileIds', JSON.stringify([PROFILE]))
  const db = await getDB()
  for (const store of ['profiles', 'accounts', 'import_sources'] as const) await db.clear(store)
  await db.add('profiles', { id: PROFILE, name: 'Household', created_at: '2026-01-01T00:00:00Z' })
  await db.add('profiles', { id: SIDE, name: 'Side', created_at: '2026-01-01T00:00:00Z' })
  const add = (store: string, row: Record<string, unknown>) =>
    (db as unknown as { add(s: string, r: unknown): Promise<unknown> }).add(store, row)
  await add('accounts', {
    id: MINE,
    profile_id: PROFILE,
    name: 'Everyday',
    type: 'giro',
    currency: 'EUR',
    balance: 0,
  })
  await add('accounts', {
    id: THEIRS,
    profile_id: SIDE,
    name: 'Theirs',
    type: 'giro',
    currency: 'EUR',
    balance: 0,
  })
  // Saved under the older rules: a sheet with no link, and another profile's account.
  await add('import_sources', {
    id: OLD_SOURCE,
    profile_id: PROFILE,
    kind: 'google_sheet',
    label: 'Old ledger',
    config: {},
    mapping: null,
    category_types: null,
    default_account_id: THEIRS,
    schedule: 'manual',
    last_synced_at: null,
    last_cursor: null,
  })
})

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(path, {
    method,
    headers: { 'X-Profile-Id': String(PROFILE) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function answer(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json() }
}

async function stored(): Promise<Record<string, unknown>[]> {
  const rows = (await (await getDB()).getAll('import_sources')) as Record<string, unknown>[]
  return rows.sort((a, b) => (a.id as number) - (b.id as number))
}

const sheet = (fields: Record<string, unknown> = {}) => ({
  kind: 'google_sheet',
  label: 'Bank ledger',
  config: { url: SHEET, sheetName: 'Sheet1' },
  schedule: 'manual',
  ...fields,
})

describe('a new source', () => {
  it('is refused at each field that cannot be stored, and nothing is saved', async () => {
    const before = await stored()
    const refused = async (fields: Record<string, unknown>) => {
      const { status, body } = await answer(
        await send('POST', '/api/import-sources', sheet(fields))
      )
      expect(status).toBe(400)
      return body.fields
    }
    expect(await refused({ kind: 'dropbox', schedule: 'hourly', label: 'x'.repeat(201) })).toEqual({
      kind: M.kind,
      schedule: M.schedule,
      label: M.labelLength,
    })
    expect(await refused({ label: 42, config: 'sheet' })).toEqual({
      label: M.label,
      config: M.config,
    })
    expect(await refused({ config: {} })).toEqual({ 'config.url': M.url })
    expect(await refused({ default_account_id: THEIRS })).toEqual({ default_account_id: M.account })
    expect(await refused({ default_account_id: 'Everyday' })).toEqual({
      default_account_id: M.account,
    })
    expect(await refused({ schedule: 'daily', label: 7 })).toEqual({ label: M.label })
    expect(await stored()).toEqual(before)
  })

  it('is saved with its name trimmed and its own account', async () => {
    const { status, body } = await answer(
      await send(
        'POST',
        '/api/import-sources',
        sheet({ label: '  Bank ledger ', default_account_id: MINE })
      )
    )
    expect(status).toBe(201)
    expect(body).toMatchObject({
      label: 'Bank ledger',
      default_account_id: MINE,
      config: { url: SHEET },
    })
  })
})

describe('a source saved under the older rules', () => {
  it('is renamed and stamped without its other fields being checked again', async () => {
    expect(
      (await send('PUT', `/api/import-sources/${OLD_SOURCE}`, { label: 'Ledger' })).status
    ).toBe(200)
    expect(
      (
        await send('PUT', `/api/import-sources/${OLD_SOURCE}`, {
          last_synced_at: '2026-10-08T09:30:00Z',
        })
      ).status
    ).toBe(200)
    expect(await stored()).toEqual([
      expect.objectContaining({
        id: OLD_SOURCE,
        label: 'Ledger',
        config: {},
        default_account_id: THEIRS,
        last_synced_at: '2026-10-08T09:30:00Z',
      }),
    ])
  })

  it('is refused at a field an edit sends that cannot be stored, and is left as it was', async () => {
    const before = await stored()
    for (const [fields, refused] of [
      [{ default_account_id: THEIRS }, { default_account_id: M.account }],
      [{ config: { sheetName: 'Sheet2' } }, { 'config.url': M.url }],
      [{ kind: 'dropbox' }, { kind: M.kind }],
      [{ schedule: 'weekly' }, { schedule: M.schedule }],
    ] as const) {
      expect(await answer(await send('PUT', `/api/import-sources/${OLD_SOURCE}`, fields))).toEqual({
        status: 400,
        body: { error: Object.values(refused).join(' '), fields: refused },
      })
    }
    expect(await stored()).toEqual(before)
  })
})

describe('a Google Sheet link to fetch', () => {
  it('is refused at the link when it is not a sheet', async () => {
    for (const payload of [
      {},
      { url: '' },
      { url: 'https://example.com/not-a-sheet' },
      { url: 12 },
    ]) {
      expect(await answer(await send('POST', '/api/import/googlesheet', payload))).toEqual({
        status: 400,
        body: { error: M.url, fields: { url: M.url } },
      })
    }
  })
})
