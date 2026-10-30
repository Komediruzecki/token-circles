/**
 * An invented person for the circles' tests: a year on file, in Solid ground, with 2 months of
 * essentials put by against 2,000 needed a month and no debts. Round values, none of them anyone's.
 */
import type { GuidanceFacts } from '../../../../shared/guidance/facts'

/** Whole euros, as the app writes them. */
export const words = {
  money: (n: number): string =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n),
}

export const BASE_FACTS: GuidanceFacts = {
  today: '2026-10-15',
  region: 'EU27',
  months: Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`),
  monthsInYear: 12,
  firm: true,
  averaged: true,
  sortedShare: 96,
  income: 3000,
  ownIncome: 3000,
  spending: 2500,
  annualSpending: 30000,
  essentials: 2000,
  unsure: { categories: 0, uncategorised: 0, all: false },
  liquid: 4000,
  cushionMonths: 2,
  invested: 0,
  debts: [],
  accountsKnown: true,
  principalRepaid: 0,
  savings: { rate: 16.7, cash: 16.7, withPrincipal: 16.7 },
  withdrawalRatePct: 4,
  enoughPerYear: null,
  freeMoney: null,
}

/** The person above, with `over` changed. */
export const facts = (over: Partial<GuidanceFacts> = {}): GuidanceFacts => ({
  ...BASE_FACTS,
  ...over,
})
