import type { Context } from 'hono'
import type { AppEnv } from './index'

/**
 * Production error logging for the API worker.
 *
 * Always emits a structured `console.error` line — captured by Cloudflare Workers Observability
 * (enabled in wrangler.jsonc) — and for 5xx failures also persists a row to the `error_logs` D1
 * table (migration 0013) so incidents survive the short Workers-Logs retention window and stay
 * queryable from our own database.
 *
 * 4xx client errors (validation, auth, not-found) are intentional control flow and are NOT logged,
 * to keep the signal clean. The D1 write is best-effort (via `executionCtx.waitUntil`) and never
 * affects the response the client receives.
 */
export function logWorkerError(c: Context<AppEnv>, err: unknown, status: number): void {
  if (status < 500) return

  const e = err as { message?: string; stack?: string }
  const method = c.req.method
  const path = c.req.path
  const requestId = c.req.header('cf-ray') ?? null
  const userId = (c.get('userId') as number | undefined) ?? null
  const message = e?.message ?? String(err)
  const stack = e?.stack ?? null

  console.error(
    JSON.stringify({ level: 'error', status, method, path, message, requestId, userId, stack })
  )

  const db = c.env?.DB
  if (!db) return

  const insert = db
    .prepare(
      `INSERT INTO error_logs (method, path, status, message, stack, user_id, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(method, path, status, message, stack, userId, requestId)
    .run()
    .then(() => undefined)
    .catch((dbErr: unknown) => {
      console.error('error_logs insert failed:', dbErr)
    })

  try {
    c.executionCtx.waitUntil(insert)
  } catch {
    // executionCtx is unavailable outside the request lifecycle (e.g. unit tests); the insert
    // promise still runs, we just can't defer it to the platform. Swallow to avoid masking the
    // original error the caller is handling.
    void insert
  }
}
