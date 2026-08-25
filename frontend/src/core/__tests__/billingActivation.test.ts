import { describe, expect, it, vi } from 'vitest'
import {
  BILLING_CONFIRM_DELAYS_MS,
  billingActivated,
  confirmBillingActivation,
} from '../billingActivation'

/**
 * The bug this guards: Stripe redirects the browser the moment payment succeeds, but the plan is
 * written by a webhook that arrives seconds later. Settings read the status once at mount, lost
 * that race, and left the page showing Free until the user reloaded by hand.
 */

/** Reads the given snapshots in order, then repeats the last one forever. */
const reader = (sequence: Array<{ plan?: string; status?: string | null } | null>) => {
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
