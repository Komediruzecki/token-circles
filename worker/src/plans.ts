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
  advancedReports: boolean; // tax summary + P&L reports (plain monthly/annual PDF stays free)
}

export interface PlanDef {
  id: PlanId;
  name: string;
  // Historical field names: prices are actually charged in EUR by Stripe
  // (the checkout prices are €3/€6 monthly). Renaming would break the public
  // /api/plans response shape, so the names stay; render with € client-side.
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
    // Local-first: no cloud sync, no receipt storage, no managed email. Everything runs on the
    // user's device (client-only, no account needed) or their own self-hosted worker —
    // Obsidian-style. Email reminders need data on our server, so they are a paid feature (0 here).
    limits: { receiptsPerProfile: 0, remindersPerMonth: 0, profiles: 2 },
    features: { cloudSync: false, emailReminders: false, receipts: false, advancedReports: false },
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    monthlyPriceUsd: 3,
    annualPriceUsd: 30, // annual ≈ 2 months free
    limits: { receiptsPerProfile: 500, remindersPerMonth: 2000, profiles: 5 },
    features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: true },
  },
  advanced: {
    id: 'advanced',
    name: 'Advanced',
    monthlyPriceUsd: 6,
    annualPriceUsd: 60, // annual ≈ 2 months free
    limits: { receiptsPerProfile: 5000, remindersPerMonth: 20000, profiles: 10 },
    features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: true },
  },
  ultimate: {
    id: 'ultimate',
    name: 'Ultimate',
    monthlyPriceUsd: 10,
    annualPriceUsd: 100, // annual ≈ 2 months free
    // "Unlimited" (null) limits are subject to FAIR_USE_NOTICE.
    limits: { receiptsPerProfile: null, remindersPerMonth: null, profiles: null },
    features: { cloudSync: true, emailReminders: true, receipts: true, advancedReports: true },
  },
};

// User-facing notices, surfaced in the billing/plan UI. Edit the text here.
export const BETA_NOTICE = 'Plans, prices and limits may change at any time during beta.';
export const FAIR_USE_NOTICE = 'Ultimate "unlimited" usage is subject to fair-use limits.';

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
