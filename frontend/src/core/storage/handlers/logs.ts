/**
 * Log handlers — IndexedDB-backed implementations for /api/logs routes.
 */
import { adapter, json, ok } from './helpers'

export async function logsList(query: URLSearchParams): Promise<Response> {
  const level = query.get('level') || undefined
  const limit = parseInt(query.get('limit') || '50', 10)
  const offset = parseInt(query.get('offset') || '0', 10)
  const logs = await adapter.getLogs({ level, limit, offset })
  return json(logs)
}

export async function logsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid log data' }, 400)
  const entry = body as Record<string, unknown>
  const id = await adapter.addLog({
    timestamp: (entry.timestamp as string) || new Date().toISOString(),
    level: (entry.level as string) || 'error',
    source: (entry.source as string) || 'client',
    error: (entry.error as string) || (typeof entry.message === 'string' ? entry.message : ''),
    stack: entry.stack as string | null | undefined,
    request: entry.request as Record<string, unknown> | null | undefined,
  })
  return json({ id, ok: true }, 201)
}

export async function logsClear(): Promise<Response> {
  await adapter.clearLogs()
  return ok()
}
