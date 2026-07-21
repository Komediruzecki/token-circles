/**
 * Import session log handlers — IndexedDB-backed (mirrors worker migration 0014).
 * One row per successful import: counts + a JSON details blob with created names.
 */
import { getDB } from '../idb'
import { adapter, idParam, json } from './helpers'

export async function importLogsList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  const all: Record<string, unknown>[] = []
  for (const pid of pids) {
    const rows = await db.getAllFromIndex('import_logs', 'by_profile', pid)
    all.push(...rows)
  }
  all.sort((a, b) => (b.id as number) - (a.id as number))
  return json(all.slice(0, 50))
}

export async function importLogsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid import log' }, 400)
  const b = body as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0)
  const db = await getDB()
  const row = {
    profile_id: await adapter.getCurrentProfileId(),
    import_id: typeof b.import_id === 'string' ? b.import_id.slice(0, 64) : null,
    source: typeof b.source === 'string' ? b.source.slice(0, 200) : '',
    imported: num(b.imported),
    duplicates_skipped: num(b.duplicates_skipped),
    accounts_created: num(b.accounts_created),
    categories_created: num(b.categories_created),
    details: typeof b.details === 'string' ? b.details.slice(0, 8000) : null,
    created_at: new Date().toISOString(),
  }
  const id = (await db.add('import_logs', row)) as number
  return json({ id, ...row }, 201)
}

/**
 * Undo a whole import: delete every transaction stamped with the log's import_id, recompute
 * account balances, then remove the log row. Only imports whose transactions carry an
 * import_id can be undone (older imports predate batch stamping) — those delete 0 rows and
 * just clear the log entry. DELETE /api/import-logs/:id.
 */
export async function importLogsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const logId = idParam(params)
  const log = (await db.get('import_logs', logId)) as Record<string, unknown> | undefined
  if (!log || log.profile_id !== pid) return json({ error: 'Import not found' }, 404)

  const importId = typeof log.import_id === 'string' ? log.import_id : ''
  let deleted = 0
  if (importId) {
    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Record<
      string,
      unknown
    >[]
    for (const t of txns) {
      if (t.import_id === importId) {
        await db.delete('transactions', t.id as number)
        deleted++
      }
    }
    if (deleted > 0) await adapter.recomputeBalances(pid)
  }
  await db.delete('import_logs', logId)
  return json({ deleted, import_id: importId || null })
}
