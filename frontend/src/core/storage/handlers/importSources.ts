/**
 * Saved import sources ("Connected Sources") — IndexedDB-backed, mirrors worker migration
 * 0020 / routes/import-sources.ts. A saved Google-Sheet link (later: Drive folder / bank
 * aggregator) the user re-fetches + imports on demand. config/mapping/category_types are
 * stored as plain objects (IndexedDB is schemaless) and returned as-is, matching the worker's
 * parsed API shape so both runtimes present the same contract to the client.
 */
import { getDB } from '../idb'
import { adapter, idParam, json, writeProfileIdFromHeaders } from './helpers'

const KINDS = new Set(['google_sheet', 'google_drive_folder', 'bank_aggregator'])
const SCHEDULES = new Set(['manual', 'on_open', 'daily'])

type Writable = Record<string, unknown>

/** Extract writable fields from a body; `partial` keeps only the keys present (for update). */
function readWritable(
  b: Record<string, unknown>,
  partial: boolean
): { data: Writable; error?: string } {
  const data: Writable = {}
  if (!partial || 'kind' in b) {
    const kind = typeof b.kind === 'string' ? b.kind : 'google_sheet'
    if (!KINDS.has(kind)) return { data, error: 'Invalid kind' }
    data.kind = kind
  }
  if (!partial || 'label' in b)
    data.label = typeof b.label === 'string' ? b.label.slice(0, 200) : ''
  if (!partial || 'config' in b)
    data.config = b.config && typeof b.config === 'object' ? b.config : {}
  if ('mapping' in b) data.mapping = b.mapping && typeof b.mapping === 'object' ? b.mapping : null
  if ('category_types' in b)
    data.category_types =
      b.category_types && typeof b.category_types === 'object' ? b.category_types : null
  if ('default_account_id' in b)
    data.default_account_id =
      typeof b.default_account_id === 'number' && Number.isFinite(b.default_account_id)
        ? Math.floor(b.default_account_id)
        : null
  if (!partial || 'schedule' in b) {
    const schedule = typeof b.schedule === 'string' ? b.schedule : 'manual'
    if (!SCHEDULES.has(schedule)) return { data, error: 'Invalid schedule' }
    data.schedule = schedule
  }
  if ('last_synced_at' in b)
    data.last_synced_at =
      typeof b.last_synced_at === 'string' ? b.last_synced_at.slice(0, 40) : null
  if ('last_cursor' in b)
    data.last_cursor = typeof b.last_cursor === 'string' ? b.last_cursor.slice(0, 200) : null
  return { data }
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
  if (!body || typeof body !== 'object') return json({ error: 'Invalid source' }, 400)
  const { data, error } = readWritable(body as Record<string, unknown>, false)
  if (error) return json({ error }, 400)
  const db = await getDB()
  const now = new Date().toISOString()
  const row = {
    profile_id: await writeProfileIdFromHeaders(headers),
    kind: 'google_sheet',
    label: '',
    config: {},
    mapping: null,
    category_types: null,
    default_account_id: null,
    schedule: 'manual',
    last_synced_at: null,
    last_cursor: null,
    ...data,
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
  if (!body || typeof body !== 'object') return json({ error: 'Invalid source' }, 400)
  const { data, error } = readWritable(body as Record<string, unknown>, true)
  if (error) return json({ error }, 400)
  const db = await getDB()
  const id = idParam(params)
  const pid = await writeProfileIdFromHeaders(headers)
  const existing = (await db.get('import_sources', id)) as Record<string, unknown> | undefined
  if (!existing || existing.profile_id !== pid) return json({ error: 'Source not found' }, 404)
  Object.assign(existing, data, { updated_at: new Date().toISOString() })
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
