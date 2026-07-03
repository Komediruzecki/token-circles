/**
 * Demo subscription seed data contract.
 *
 * The Bills → Subscriptions view resolves brand icons by matching the bill NAME against
 * subscriptionBrands keywords. These tests pin that every seeded demo subscription
 * actually resolves to a real brand (no generic-icon fallbacks in the demo), that tiers
 * scale (low < mid < high) as intended, and that the rows are shaped sanely.
 */
import { describe, expect, it } from 'vitest'
import { matchBrand } from '../../../features/subscriptionBrands'
import { DEMO_SUBSCRIPTIONS } from '../idb'

const tiers = ['low', 'mid', 'high'] as const

describe('DEMO_SUBSCRIPTIONS', () => {
  it('every seeded subscription name resolves to a known brand icon', () => {
    for (const tier of tiers) {
      for (const sub of DEMO_SUBSCRIPTIONS[tier]) {
        const brand = matchBrand(sub.name)
        expect(brand.displayName, `"${sub.name}" (${tier}) should match a brand`).not.toBe('')
      }
    }
  })

  it('tiers scale with income: low < mid < high', () => {
    expect(DEMO_SUBSCRIPTIONS.low.length).toBeLessThan(DEMO_SUBSCRIPTIONS.mid.length)
    expect(DEMO_SUBSCRIPTIONS.mid.length).toBeLessThan(DEMO_SUBSCRIPTIONS.high.length)
  })

  it('rows are sanely shaped (positive price, <=2 decimals, valid due day)', () => {
    for (const tier of tiers) {
      for (const sub of DEMO_SUBSCRIPTIONS[tier]) {
        expect(sub.amount).toBeGreaterThan(0)
        const decimals = (String(sub.amount).split('.')[1] || '').length
        expect(decimals, `"${sub.name}" amount ${sub.amount}`).toBeLessThanOrEqual(2)
        expect(sub.dueDay).toBeGreaterThanOrEqual(1)
        expect(sub.dueDay).toBeLessThanOrEqual(28)
        expect(sub.name.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('no duplicate subscription names within a tier', () => {
    for (const tier of tiers) {
      const names = DEMO_SUBSCRIPTIONS[tier].map((s) => s.name)
      expect(new Set(names).size, `${tier} tier`).toBe(names.length)
    }
  })
})
