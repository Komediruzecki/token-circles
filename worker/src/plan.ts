import type { Context } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './http';
import { planHasFeature, planLimit } from './plans';

// Plan enforcement. The actual tiers/limits/features live in plans.ts (the single source of
// truth) — this module just reads the authenticated user's plan and applies it.
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file (applies to all paid tiers)
export const RECEIPT_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];

export async function getUserPlan(c: Context<AppEnv>): Promise<string> {
  const row = await c.env.DB.prepare('SELECT plan FROM users WHERE id = ?')
    .bind(c.get('userId'))
    .first<{ plan: string }>();
  return row?.plan ?? 'free';
}

/** Throw 402 unless the user's plan includes a feature (plans.ts). */
export async function requireFeature(
  c: Context<AppEnv>,
  feature: 'cloudSync' | 'emailReminders' | 'receipts' | 'advancedReports',
  message: string
): Promise<void> {
  if (!planHasFeature(await getUserPlan(c), feature)) throw new HttpError(402, message);
}

/** Receipt-storage gate (kept for the existing call site). */
export async function requirePremium(c: Context<AppEnv>): Promise<void> {
  await requireFeature(
    c,
    'receipts',
    'Receipt storage is a paid feature. Upgrade to upload receipts.'
  );
}

/** Per-plan receipt count cap (null = unlimited). */
export async function receiptCountLimit(c: Context<AppEnv>): Promise<number | null> {
  return planLimit(await getUserPlan(c), 'receiptsPerProfile');
}
