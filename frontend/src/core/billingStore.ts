import { createSignal } from 'solid-js'
import { apiFetch } from './apiFetch'

/**
 * Client-side plan cache for gating premium-only UI (receipt attach, email alerts).
 *
 * `null` = unknown — plan not loaded yet, demo/serverless mode, or signed out. We FAIL
 * OPEN: a control locks ONLY when we positively know the plan is Free, so we never hide a
 * working feature from a paid user (or a demo user) just because the plan hasn't loaded.
 *
 * The plan -> feature rule mirrors worker/src/plans.ts: every paid tier (basic / advanced /
 * ultimate, and the legacy 'premium' alias) includes receipts + email alerts; only the Free
 * tier lacks them. So "locked" == "known to be on Free".
 */
const [planId, setPlanId] = createSignal<string | null>(null)

/** Update the cached plan — called by the billing-status fetch and after an upgrade. */
export function setCurrentPlan(plan: string | null): void {
  setPlanId(plan)
}

const isKnownFree = (): boolean => planId() === 'free'

/** True only when the user is known to be on Free, so the premium control should be locked. */
export const receiptsLocked = isKnownFree
export const emailAlertsLocked = isKnownFree

/** Fetch the current plan once (server mode). Safe no-op on failure / demo / signed out. */
export async function loadBillingPlan(): Promise<void> {
  try {
    const res = await apiFetch('/api/billing/status', { credentials: 'include' })
    if (!res.ok) return
    const data = (await res.json()) as { plan?: string }
    if (typeof data.plan === 'string') setCurrentPlan(data.plan)
  } catch {
    /* leave unknown -> nothing locked */
  }
}
