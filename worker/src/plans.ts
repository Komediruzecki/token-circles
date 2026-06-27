// ─────────────────────────────────────────────────────────────────────────────
// PLAN / ENTITLEMENTS CONFIG — the SINGLE source of truth for tiers, limits and
// feature gates. To change what a plan includes, edit ONLY the PLANS object below;
// every call site reads through the helpers, so nothing else needs to change.
//
// `null` in a limit means "unlimited". Prices are display-only — the real charge is
// whatever Stripe Price you attach. Starting numbers come from a competitor pricing
// study (see ~/.dotfiles/personal/finance/pricing-plans.md); tune them freely here.
// ─────────────────────────────────────────────────────────────────────────────

export type PlanId = 'free' | 'basic' | 'advanced' | 'ultimate';

export interface PlanLimits {
  receiptsPerProfile: number | null; // premium receipt files kept per profile
  remindersPerMonth: number | null; // outbound reminder emails per month
  profiles: number | null; // how many profiles / households
}

export interface PlanFeatures {
  cloudSync: boolean; // data synced to the account (server) vs local-only
  emailReminders: boolean; // budget alerts + spending reports by email
  receipts: boolean; // receipt file storage (R2)
  advancedReports: boolean; // tax / P&L / forecast / extended analytics exports
}

export interface PlanDef {
  id: PlanId;
  name: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number;
  limits: PlanLimits;
  features: PlanFeatures;
}

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    // Local-only (no cloud sync) → the worker holds no data for free users, so receipts and
    // server-side reminders are inherently paid. Core budgeting stays fully usable client-side.
    limits: { receiptsPerProfile: 0, remindersPerMonth: 0, profiles: 1 },
    features: { cloudSync: false, emailReminders: false, receipts: false, advancedReports: false },
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    monthlyPriceUsd: 4.99,
    annualPriceUsd: 39,
    limits: { receiptsPerProfile: 500, remindersPerMonth: 2000, profiles: 1 },
    features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: false },
  },
  advanced: {
    id: 'advanced',
    name: 'Advanced',
    monthlyPriceUsd: 8.99,
    annualPriceUsd: 69,
    limits: { receiptsPerProfile: 5000, remindersPerMonth: 20000, profiles: 3 },
    features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: true },
  },
  ultimate: {
    id: 'ultimate',
    name: 'Ultimate',
    monthlyPriceUsd: 13.99,
    annualPriceUsd: 109,
    limits: { receiptsPerProfile: null, remindersPerMonth: null, profiles: null },
    features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: true },
  },
};

// The current Stripe webhook stores users.plan = 'premium' (single price). Until per-tier
// Stripe Prices are wired, map that legacy value to a concrete tier here.
const ALIASES: Record<string, PlanId> = { premium: 'advanced' };

/** Resolve a raw users.plan value to a plan definition (defaults to Free). */
export function planOf(raw: string | null | undefined): PlanDef {
  const id = (ALIASES[raw ?? ''] ?? raw ?? 'free') as PlanId;
  return PLANS[id] ?? PLANS.free;
}

export function planHasFeature(raw: string | null | undefined, f: keyof PlanFeatures): boolean {
  return planOf(raw).features[f];
}

export function planLimit(raw: string | null | undefined, k: keyof PlanLimits): number | null {
  return planOf(raw).limits[k];
}
