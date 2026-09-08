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
  apiTokens: number | null; // live (unrevoked, unexpired) API tokens
  receiptMaxMb: number; // largest single receipt upload, in MB
}

export interface PlanFeatures {
  cloudSync: boolean; // data synced to the account (server) vs local-only
  emailReminders: boolean; // budget alerts + spending reports by email
  receipts: boolean; // receipt file storage (R2)
  advancedReports: boolean; // tax summary + P&L reports (plain monthly/annual PDF stays free)
  apiAccess: boolean; // REST API tokens and the MCP server
  automatedImports: boolean; // import sources on a schedule, run on our machines
  prioritySupport: boolean; // see SUPPORT_RESPONSE_NOTICE
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
    // The API authenticates against account data on our server, which Free does not have, so
    // apiAccess is false here for the same reason cloudSync is — not as an upsell.
    limits: { receiptsPerProfile: 0, remindersPerMonth: 0, profiles: 2, apiTokens: 0, receiptMaxMb: 0 },
    features: {
      cloudSync: false,
      emailReminders: false,
      receipts: false,
      advancedReports: false,
      apiAccess: false,
      automatedImports: false,
      prioritySupport: false,
    },
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    monthlyPriceUsd: 3,
    annualPriceUsd: 30, // annual ≈ 2 months free
    // 500 reminders, not the 2 000 this used to advertise: a household on top of every bill
    // sends about thirty a month, so the old number promised a cost we would have eaten if
    // anyone had taken it literally.
    limits: {
      receiptsPerProfile: 500,
      remindersPerMonth: 500,
      profiles: 5,
      apiTokens: 2,
      receiptMaxMb: 5,
    },
    features: {
      cloudSync: true,
      emailReminders: true,
      receipts: true,
      advancedReports: true,
      apiAccess: true,
      automatedImports: false,
      prioritySupport: false,
    },
  },
  advanced: {
    id: 'advanced',
    name: 'Advanced',
    monthlyPriceUsd: 6,
    annualPriceUsd: 60, // annual ≈ 2 months free
    limits: {
      receiptsPerProfile: 5000,
      remindersPerMonth: 2000,
      profiles: 10,
      apiTokens: 10,
      receiptMaxMb: 25,
    },
    features: {
      cloudSync: true,
      emailReminders: true,
      receipts: true,
      advancedReports: true,
      apiAccess: true,
      automatedImports: true,
      prioritySupport: false,
    },
  },
  ultimate: {
    id: 'ultimate',
    name: 'Ultimate',
    monthlyPriceUsd: 10,
    annualPriceUsd: 100, // annual ≈ 2 months free
    // "Unlimited" (null) limits are subject to FAIR_USE_NOTICE.
    limits: {
      receiptsPerProfile: null,
      remindersPerMonth: null,
      profiles: null,
      apiTokens: null,
      receiptMaxMb: 50,
    },
    features: {
      cloudSync: true,
      emailReminders: true,
      receipts: true,
      advancedReports: true,
      apiAccess: true,
      automatedImports: true,
      prioritySupport: true,
    },
  },
};

// User-facing notices, surfaced in the billing/plan UI. Edit the text here.
export const BETA_NOTICE = 'Plans, prices and limits may change at any time during beta.';
export const FAIR_USE_NOTICE = 'Ultimate "unlimited" usage is subject to fair-use limits.';
// A promise, not a feature flag: this exact wording is on the card, in the Stripe description
// and on the invoice, so change it in one place and it changes everywhere it was promised.
export const SUPPORT_RESPONSE_NOTICE = 'Priority support: a reply within 1-3 working days.';

/*
 * Decided but NOT listed, because neither is built (docs/plans/billing-tiers.md):
 *   - Receipt OCR      -> Advanced and up, when it ships.
 *   - End-to-end encryption -> tier still open, Basic or Advanced.
 * A pricing page that lists a feature the product does not have is a misleading commercial
 * practice under the UCPD, so the row appears the day the feature does, not before.
 */

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
