import { describe, expect, it, vi } from 'vitest'
import {
  BILLING_CONFIRM_DELAYS_MS,
  billingActivated,
  confirmBillingActivation,
  hasManageableSubscription,
} from '../billingActivation'

/**
 * The bug this guards: Stripe redirects the browser the moment payment succeeds, but the plan is
 * written by a webhook that arrives seconds later. Settings read the status once at mount, lost
 * that race, and left the page showing Free until the user reloaded by hand.
 */

/** Reads the given snapshots in order, then repeats the last one forever. */
const reader = (
  sequence: Array<{ plan?: string; status?: string | null; interval?: string | null } | null>
) => {
  let i = 0
  const read = async () => {
    const value = sequence[Math.min(i, sequence.length - 1)]
    i += 1
    return value
  }
  return { read, reads: () => i }
}

/** No clock: record what we WOULD have waited and return immediately. */
const recorder = () => {
  const waited: number[] = []
  return { waited, sleep: async (ms: number) => void waited.push(ms) }
}

const free = { plan: 'free', status: null }
const advanced = { plan: 'advanced', status: 'active' }
const ultimate = { plan: 'ultimate', status: 'active' }

describe('billingActivated', () => {
  it('is false while the webhook has not landed', () => {
    expect(billingActivated('advanced', free)).toBe(false)
  })

  it('is true once the tier that was bought is entitled', () => {
    expect(billingActivated('advanced', advanced)).toBe(true)
  })

  it('is false for a DIFFERENT paid tier — the one being switched away from', () => {
    // The case the `plan` query param exists for. A checkout return is a fresh page load with no
    // memory of the pre-checkout plan, so without the hint this read is indistinguishable from
    // success, and buying Ultimate would announce "Advanced plan activated".
    expect(billingActivated('ultimate', advanced)).toBe(false)
    expect(billingActivated('ultimate', ultimate)).toBe(true)
  })

  it('accepts the legacy premium alias in both directions', () => {
    // billing.ts stores 'premium' from the single-price era; the tier is the same thing.
    expect(billingActivated('advanced', { plan: 'premium', status: 'active' })).toBe(true)
    expect(billingActivated('premium', advanced)).toBe(true)
  })

  it('counts trialing and past_due as landed, matching the worker', () => {
    // isEntitled in routes/billing.ts keeps the plan through a dunning grace window, so the page
    // must agree — showing Free for a past_due subscriber would contradict what they can do.
    expect(billingActivated('advanced', { plan: 'advanced', status: 'trialing' })).toBe(true)
    expect(billingActivated('advanced', { plan: 'advanced', status: 'past_due' })).toBe(true)
  })

  it('is false for a plan that is set but not entitled', () => {
    expect(billingActivated('advanced', { plan: 'advanced', status: 'canceled' })).toBe(false)
    expect(billingActivated('advanced', { plan: 'advanced', status: 'incomplete_expired' })).toBe(
      false
    )
  })

  it('is false for an unreadable status, so a failed fetch never reads as activation', () => {
    expect(billingActivated('advanced', null)).toBe(false)
  })

  /**
   * The interval switch. Monthly -> annual keeps the same tier, and that tier is already
   * entitled, so tier-only matching said "landed" on the very first read and the toast announced
   * a switch Stripe had not made yet. Without the interval argument every one of these is true.
   */
  it('is false while a same-tier interval switch is still on the old interval', () => {
    expect(
      billingActivated('basic', { plan: 'basic', status: 'active', interval: 'monthly' }, 'annual')
    ).toBe(false)
  })

  it('is true once the interval has actually moved', () => {
    expect(
      billingActivated('basic', { plan: 'basic', status: 'active', interval: 'annual' }, 'annual')
    ).toBe(true)
  })

  it('still requires the tier to match when an interval is expected', () => {
    expect(
      billingActivated(
        'ultimate',
        { plan: 'basic', status: 'active', interval: 'annual' },
        'annual'
      )
    ).toBe(false)
  })

  it('ignores the interval when the caller has no hint to give', () => {
    expect(
      billingActivated('basic', { plan: 'basic', status: 'active', interval: 'monthly' })
    ).toBe(true)
  })

  it('does not hold out for an interval the row has never carried', () => {
    // A subscription that predates migration 0025 has no interval. Waiting for one would poll the
    // full backoff and then announce nothing, so an absent interval means "cannot tell".
    expect(
      billingActivated('basic', { plan: 'basic', status: 'active', interval: null }, 'annual')
    ).toBe(true)
  })

  it('falls back to any entitled paid plan when the URL carries no hint', () => {
    // Links minted before the plan param shipped, or a hand-typed ?billing=success.
    expect(billingActivated(null, advanced)).toBe(true)
    expect(billingActivated(null, free)).toBe(false)
    expect(billingActivated(null, { plan: 'advanced', status: 'canceled' })).toBe(false)
  })
})

describe('confirmBillingActivation', () => {
  it('stops at the first read that shows the tier, and reports what it saw', async () => {
    const { read, reads } = reader([free, free, advanced])
    const { sleep, waited } = recorder()
    const onChanged = vi.fn()

    const outcome = await confirmBillingActivation({ expected: 'advanced', read, sleep, onChanged })

    expect(outcome).toBe('changed')
    expect(reads()).toBe(3) // stopped; did not run the remaining delays
    expect(waited).toEqual(BILLING_CONFIRM_DELAYS_MS.slice(0, 3))
    expect(onChanged).toHaveBeenCalledWith(advanced)
  })

  it('keeps waiting through the old tier during a switch', async () => {
    // Advanced -> Ultimate. The first reads show Advanced because the webhook has not landed;
    // announcing there would name the tier the user just left.
    const { read } = reader([advanced, advanced, ultimate])
    const { sleep } = recorder()
    const onChanged = vi.fn()

    const outcome = await confirmBillingActivation({ expected: 'ultimate', read, sleep, onChanged })

    expect(outcome).toBe('changed')
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith(ultimate)
  })

  it('keeps waiting through a same-tier interval switch', async () => {
    // Basic monthly -> Basic annual. Every read here is an entitled Basic plan, so tier-only
    // matching announced on the first one; only the interval separates "before" from "after".
    const monthly = { plan: 'basic', status: 'active', interval: 'monthly' }
    const annual = { plan: 'basic', status: 'active', interval: 'annual' }
    const { read, reads } = reader([monthly, monthly, annual])
    const { sleep } = recorder()
    const onChanged = vi.fn()

    const outcome = await confirmBillingActivation({
      expected: 'basic',
      expectedInterval: 'annual',
      read,
      sleep,
      onChanged,
    })

    expect(outcome).toBe('changed')
    expect(reads()).toBe(3)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith(annual)
  })

  it('waits before the first read — the mount fetch has already happened', async () => {
    const { read } = reader([advanced])
    const { sleep, waited } = recorder()

    await confirmBillingActivation({ expected: 'advanced', read, sleep })

    expect(waited[0]).toBe(BILLING_CONFIRM_DELAYS_MS[0])
    expect(waited[0]).toBeGreaterThan(0)
  })

  it('gives up after the last delay rather than polling forever', async () => {
    const { read, reads } = reader([free])
    const { sleep, waited } = recorder()

    const outcome = await confirmBillingActivation({ expected: 'advanced', read, sleep })

    expect(outcome).toBe('timeout')
    expect(reads()).toBe(BILLING_CONFIRM_DELAYS_MS.length)
    expect(waited).toEqual(BILLING_CONFIRM_DELAYS_MS)
  })

  it('does not announce activation when every read fails', async () => {
    // A signed-out or 500 response reads as null. Announcing a plan there would be a lie, and
    // timing out is the honest outcome — Stripe still took the money.
    const { read } = reader([null])
    const { sleep } = recorder()
    const onChanged = vi.fn()

    const outcome = await confirmBillingActivation({ expected: 'advanced', read, sleep, onChanged })

    expect(outcome).toBe('timeout')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('backs off rather than hammering the endpoint at a fixed interval', () => {
    for (let i = 1; i < BILLING_CONFIRM_DELAYS_MS.length; i += 1)
      expect(BILLING_CONFIRM_DELAYS_MS[i]).toBeGreaterThan(BILLING_CONFIRM_DELAYS_MS[i - 1])
  })

  it('waits long enough to outlast a slow webhook', () => {
    // Dev measured ~3s from redirect to the plan landing. A budget under ~15s would reintroduce
    // the bug for anyone slower than that, which is the whole point of this file.
    const total = BILLING_CONFIRM_DELAYS_MS.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(15_000)
  })
})

/**
 * The manage link is a way OUT — cancelling, switching, replacing a card. Offering it to someone
 * it cannot work for is worse than not offering it, because the only way to find out is to click
 * it and be told "No billing account yet".
 */
describe('hasManageableSubscription', () => {
  it('is false on Free, which has no subscription at all', () => {
    expect(hasManageableSubscription({ plan: 'free', status: null })).toBe(false)
  })

  it('is false for a comped plan, which has no Stripe customer behind it', () => {
    // The regression: gating on "not free" alone offered the portal to granted accounts, where
    // /api/billing/portal can only answer 400 — directly above a card reading
    // "Granted — nothing to manage".
    expect(hasManageableSubscription({ plan: 'basic', status: 'comped' })).toBe(false)
  })

  it('is true for a paying subscriber', () => {
    expect(hasManageableSubscription({ plan: 'basic', status: 'active' })).toBe(true)
  })

  it('is true while payment is past due — that is exactly when the card needs replacing', () => {
    expect(hasManageableSubscription({ plan: 'advanced', status: 'past_due' })).toBe(true)
  })

  it('is true for a cancelled-but-not-yet-expired plan, so the cancellation can be taken back', () => {
    expect(hasManageableSubscription({ plan: 'ultimate', status: 'canceled' })).toBe(true)
  })

  it('is false before the status has loaded, rather than flashing a link that may not apply', () => {
    expect(hasManageableSubscription(null)).toBe(false)
  })
})
