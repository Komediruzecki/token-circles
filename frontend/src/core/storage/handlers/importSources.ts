/**
 * Saved import sources ("Connected Sources") — IndexedDB-backed, mirrors worker migration
 * 0020 / routes/import-sources.ts. A saved Google-Sheet link (later: Drive folder / bank
 * aggregator) the user re-fetches + imports on demand. config/mapping/category_types are
 * stored as plain objects (IndexedDB is schemaless) and returned as-is, matching the worker's
 * parsed API shape so both runtimes present the same contract to the client.
 */
import {
  checkImportSourceCreate,
  checkImportSourceEdit,
  foreignSourceAccount,
  IMPORT_SOURCE_MESSAGES,
} from '../../../../../shared/importSourceSchema'
import { getDB } from '../idb'
import {
  adapter,
  currentProfileOwns,
  idParam,
  json,
  refuse,
  writeProfileIdFromHeaders,
} from './helpers'
import type { ImportSourceWrite } from '../../../../../shared/importSourceSchema'

/** Whether a checked body's default account, if it names one, is the profile's. */
async function ownAccount(value: ImportSourceWrite, profileId: number): Promise<boolean> {
  const id = value.default_account_id
  return id === undefined || id === null || currentProfileOwns('accounts', id, profileId)
}

export async function importSourcesList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  const all: Record<string, unknown>[] = []
  for (const pid of pids) {
    const rows = await db.getAllFromIndex('import_sources', 'by_profile', pid)
    all.push(...rows)
  }
  all.sort((a, b) => (b.id as number) - (a.id as number))
  return json(all)
}

export async function importSourcesCreate(body: unknown, headers?: HeadersInit): Promise<Response> {
  // The Worker's rules and words (shared/importSourceSchema.ts).
  const checked = checkImportSourceCreate(body)
  if (!checked.ok) return refuse(checked.fields)
  const profileId = await writeProfileIdFromHeaders(headers)
  if (!(await ownAccount(checked.value, profileId))) return refuse(foreignSourceAccount())
  const db = await getDB()
  const now = new Date().toISOString()
  const row = {
    profile_id: profileId,
    kind: 'google_sheet',
    label: '',
    config: {},
    mapping: null,
    category_types: null,
    default_account_id: null,
    schedule: 'manual',
    last_synced_at: null,
    last_cursor: null,
    ...checked.value,
    created_at: now,
    updated_at: now,
  }
  const id = (await db.add('import_sources', row)) as number
  return json({ id, ...row }, 201)
}

export async function importSourcesUpdate(
  params: Record<string, string>,
  body: unknown,
  headers?: HeadersInit
): Promise<Response> {
  const db = await getDB()
  const id = idParam(params)
  const pid = await writeProfileIdFromHeaders(headers)
  const existing = (await db.get('import_sources', id)) as Record<string, unknown> | undefined
  if (!existing || existing.profile_id !== pid) {
    return json({ error: IMPORT_SOURCE_MESSAGES.notFound }, 404)
  }
  const checked = checkImportSourceEdit(body, existing)
  if (!checked.ok) return refuse(checked.fields)
  if (!(await ownAccount(checked.value, pid))) return refuse(foreignSourceAccount())
  Object.assign(existing, checked.value, { updated_at: new Date().toISOString() })
  await db.put('import_sources', existing)
  return json(existing)
}

export async function importSourcesDelete(
  params: Record<string, string>,
  headers?: HeadersInit
): Promise<Response> {
  const db = await getDB()
  const id = idParam(params)
  const pid = await writeProfileIdFromHeaders(headers)
  const existing = (await db.get('import_sources', id)) as Record<string, unknown> | undefined
  if (!existing || existing.profile_id !== pid) return json({ error: 'Source not found' }, 404)
  await db.delete('import_sources', id)
  return json({ deleted: true })
}
