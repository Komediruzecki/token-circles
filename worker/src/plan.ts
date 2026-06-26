import type { Context } from 'hono'
import type { AppEnv } from './index'
import { HttpError } from './http'

// Receipt FILE storage is a premium feature — we don't want to hold lots of binary
// data for free accounts. Plans live in users.plan ('free' | 'premium'). PDF reports
// and spreadsheet imports stay free (they don't persist files).
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024 // 5 MB per file
export const RECEIPT_MAX_PER_PROFILE = 500 // hard cap even for premium
export const RECEIPT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']

export async function getUserPlan(c: Context<AppEnv>): Promise<string> {
  const row = await c.env.DB.prepare('SELECT plan FROM users WHERE id = ?')
    .bind(c.get('userId'))
    .first<{ plan: string }>()
  return row?.plan ?? 'free'
}

/** Throw 402 unless the user is on a paid plan. */
export async function requirePremium(c: Context<AppEnv>): Promise<void> {
  if ((await getUserPlan(c)) !== 'premium') {
    throw new HttpError(402, 'Receipt storage is a premium feature. Upgrade to upload receipts.')
  }
}
