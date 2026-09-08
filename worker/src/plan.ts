import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './http';
import { planHasFeature, planLimit, planOf } from './plans';
import type { PlanFeatures } from './plans';

// Plan enforcement. The actual tiers/limits/features live in plans.ts (the single source of
// truth) — this module just reads the authenticated user's plan and applies it.
// The floor, and what an unauthenticated size check assumes. The real cap is per plan —
// see receiptMaxBytes() — because upload size is bandwidth and R2, which is what paid buys.
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
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
  feature: keyof PlanFeatures,
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

/** Middleware: 402 unless the user's plan includes advanced reporting (tax & P&L). */
export const requireAdvancedReports: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireFeature(
    c,
    'advancedReports',
    'Advanced reporting (tax & P&L) is a paid feature. Upgrade to Basic or higher to unlock it.'
  );
  await next();
};

/** Largest single receipt upload for this user's plan, in bytes. */
export async function receiptMaxBytes(c: Context<AppEnv>): Promise<number> {
  const mb = planOf(await getUserPlan(c)).limits.receiptMaxMb;
  return Math.max(mb, 0) * 1024 * 1024;
}

/** Live API tokens this plan may hold (null = unlimited). */
export async function apiTokenLimit(c: Context<AppEnv>): Promise<number | null> {
  return planLimit(await getUserPlan(c), 'apiTokens');
}

/** Middleware: 402 unless the plan includes the REST API and the MCP server. */
export const requireApiAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireFeature(
    c,
    'apiAccess',
    'API access is a paid feature. Upgrade to Basic or higher to use API tokens.'
  );
  await next();
};
