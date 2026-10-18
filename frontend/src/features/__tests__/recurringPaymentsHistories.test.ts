/**
 * The recurring-payment finder on a year of everyday life, written by the phase 3a review rather
 * than by the finder's author: shopping at one place on random or weekly days, cash, a monthly
 * payment to a person, a pharmacy co-pay, a salary, and beside them a gym and the rent. Each
 * history is drawn from a seeded generator, for seeds 1 to 50, so every run reads the same years.
 *
 * What it pins: what is paid every week or two (the Saturday bakery) is never ticked, cash is
 * never proposed, a monthly payment to a person and a co-pay are proposed as bills, and the gym
 * and the rent are still found. Every payee is invented.
 */
import { describe, expect, it } from 'vitest'
import { detectSubscriptions, worthTracking } from '../subscriptionDetection'
import type { DetectableTransaction, DetectedSubscription } from '../subscriptionDetection'

const TODAY = '2026-10-10'
const DAY = 86_400_000
const t0 = Date.parse(`${TODAY}T00:00:00Z`)
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1)

/** mulberry32: the same numbers for the same seed, on every machine. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function spent(
  date: string,
  amount: number,
  beneficiary: string,
  description = ''
): DetectableTransaction {
  return {
    date,
    amount: -Math.abs(amount),
    beneficiary,
    description,
    type: 'expense',
    currency: 'EUR',
    category_id: null,
  }
}

type History =
  | 'supermarket weekly, varying amounts'
  | 'discounter meal deal, random days'
  | 'cafe on half the weekdays'
  | 'cafe once a week, random weekday'
  | 'pharmacy, random visits and amounts'
  | 'pharmacy, monthly co-pay'
  | 'monthly payment to a person'
  | 'salary'
  | 'ATM every 6 to 10 days'
  | 'ATM 50, 100 or 200 every 3 to 20 days'
  | 'canteen most workdays'
  | 'fuel every 6 to 9 days, varying'
  | 'card payments named by digits only'
  | 'bakery most Saturdays'
  | 'gym, monthly'
  | 'rent, monthly'

/** A year of each history for `seed`. */
function histories(seed: number): Map<History, DetectableTransaction[]> {
  const r = rng(seed)
  const out = new Map<History, DetectableTransaction[]>()
  const days = 365
  const weekday = (d: number) => new Date(t0 - d * DAY).getUTCDay()
  const add = (name: History, rows: DetectableTransaction[]) => out.set(name, rows)

  {
    const rows = []
    for (let w = 0; w < 52; w++) {
      const d = t0 - (w * 7 + Math.floor(r() * 3)) * DAY
      rows.push(spent(iso(d), 35 + r() * 60, 'SUPERMARKT BEISPIEL ZAGREB'))
    }
    add('supermarket weekly, varying amounts', rows)
  }
  {
    const rows = []
    for (let d = 0; d < days; d++) {
      if (r() < 0.4) rows.push(spent(iso(t0 - d * DAY), 4.99, 'DISKONTER PRIMJER FILIALE 1234'))
    }
    add('discounter meal deal, random days', rows)
  }
  {
    const rows = []
    for (let d = 0; d < days; d++) {
      if (weekday(d) >= 1 && weekday(d) <= 5 && r() < 0.5) {
        rows.push(spent(iso(t0 - d * DAY), 3.2, 'CAFE BAR MOLO'))
      }
    }
    add('cafe on half the weekdays', rows)
  }
  {
    const rows = []
    for (let w = 0; w < 52; w++) {
      rows.push(spent(iso(t0 - (w * 7 + Math.floor(r() * 7)) * DAY), 3.2, 'KAFIC CENTRAL'))
    }
    add('cafe once a week, random weekday', rows)
  }
  {
    const rows = []
    for (let d = 0; d < days; d += 7 + Math.floor(r() * 35)) {
      rows.push(spent(iso(t0 - d * DAY), 5 + r() * 40, 'LJEKARNA CENTAR'))
    }
    add('pharmacy, random visits and amounts', rows)
  }
  {
    const rows = []
    for (let d = 3; d < days; d += 26 + Math.floor(r() * 9)) {
      rows.push(spent(iso(t0 - d * DAY), 10, 'APOTHEKE AM MARKT'))
    }
    add('pharmacy, monthly co-pay', rows)
  }
  {
    const rows = []
    for (let m = 0; m < 12; m++) {
      rows.push(spent(iso(t0 - (m * 30 + 2) * DAY), 200, 'Ana Primjer', 'Dzeparac'))
    }
    add('monthly payment to a person', rows)
  }
  {
    const rows: DetectableTransaction[] = []
    for (let m = 0; m < 12; m++) {
      rows.push({
        date: iso(t0 - (m * 30 + 5) * DAY),
        amount: 2400,
        beneficiary: '',
        payor: 'POSLODAVAC PRIMJER DOO',
        description: 'PLACA',
        type: 'income',
        currency: 'EUR',
        category_id: null,
      })
    }
    add('salary', rows)
  }
  {
    const rows = []
    for (let d = 1; d < days; d += 6 + Math.floor(r() * 5)) {
      const terminal = 1000 + Math.floor(r() * 9000)
      rows.push(spent(iso(t0 - d * DAY), 100, '', `ATM WITHDRAWAL ${terminal} ZAGREB`))
    }
    add('ATM every 6 to 10 days', rows)
  }
  {
    const rows = []
    const amounts = [50, 100, 200]
    for (let d = 1; d < days; d += 3 + Math.floor(r() * 17)) {
      const amount = amounts[Math.floor(r() * 3)]
      rows.push(spent(iso(t0 - d * DAY), amount, '', `GELDAUTOMAT ${Math.floor(r() * 99999)}`))
    }
    add('ATM 50, 100 or 200 every 3 to 20 days', rows)
  }
  {
    const rows = []
    for (let d = 0; d < days; d++) {
      if (weekday(d) >= 1 && weekday(d) <= 5 && r() < 0.9) {
        rows.push(spent(iso(t0 - d * DAY), 6.5, 'MENZA PRIMJER'))
      }
    }
    add('canteen most workdays', rows)
  }
  {
    const rows = []
    for (let d = 2; d < days; d += 6 + Math.floor(r() * 4)) {
      rows.push(spent(iso(t0 - d * DAY), 40 + r() * 30, 'BENZINSKA PRIMJER 0042'))
    }
    add('fuel every 6 to 9 days, varying', rows)
  }
  {
    const rows = []
    for (let d = 0; d < days; d++) {
      if (r() < 0.6) {
        const text = `POS ${Math.floor(r() * 1e8)} ${Math.floor(r() * 1e4)}`
        rows.push(spent(iso(t0 - d * DAY), 3 + r() * 80, '', text))
      }
    }
    add('card payments named by digits only', rows)
  }
  {
    const rows = []
    for (let w = 0; w < 52; w++) {
      if (r() < 0.85) rows.push(spent(iso(t0 - (w * 7 + 1) * DAY), 2.4, 'PEKARA KLARA'))
    }
    add('bakery most Saturdays', rows)
  }
  {
    // A gym and the rent, a day or two either side of their date.
    const gym = []
    const rent = []
    for (let m = 0; m < 12; m++) {
      gym.push(spent(iso(t0 - (m * 30 + 4 + Math.floor(r() * 3)) * DAY), 29.9, 'KRAFTRAUM PRIMJER'))
      rent.push(
        spent(iso(t0 - (m * 30 + 8 + Math.floor(r() * 3)) * DAY), 650, 'STAN NAJAM PRIMJER')
      )
    }
    add('gym, monthly', gym)
    add('rent, monthly', rent)
  }
  return out
}

/** What the scan proposes from each history of every seed, the finder's finds only. */
const finds = new Map<History, DetectedSubscription[][]>()
for (const seed of SEEDS) {
  for (const [name, rows] of histories(seed)) {
    const found = detectSubscriptions(rows, [], { today: TODAY }).filter(
      (f) => f.matchedVia === 'recurring'
    )
    finds.set(name, [...(finds.get(name) ?? []), found])
  }
}

/** How many of the 50 years propose a ticked (likely) payment from `name`. */
const ticked = (name: History) =>
  (finds.get(name) ?? []).filter((found) => found.some(worthTracking)).length

describe('everyday spending', () => {
  it.each<History>([
    'supermarket weekly, varying amounts',
    'discounter meal deal, random days',
    'cafe on half the weekdays',
    'cafe once a week, random weekday',
    'pharmacy, random visits and amounts',
    'canteen most workdays',
    'fuel every 6 to 9 days, varying',
    'card payments named by digits only',
    'bakery most Saturdays',
    'salary',
  ])('%s is never ticked, in any of the 50 years', (name) => {
    expect(ticked(name)).toBe(0)
  })

  it('the Saturday bakery is listed as a weekly guess at most', () => {
    const listed = (finds.get('bakery most Saturdays') ?? []).flat()
    expect(listed.length).toBeGreaterThan(0)
    for (const found of listed)
      expect([found.frequency, found.confidence]).toEqual(['weekly', 'low'])
  })
})

describe('cash', () => {
  it.each<History>(['ATM every 6 to 10 days', 'ATM 50, 100 or 200 every 3 to 20 days'])(
    '%s is never proposed, in any of the 50 years',
    (name) => {
      expect((finds.get(name) ?? []).flat()).toEqual([])
    }
  )
})

describe('regular payments', () => {
  it.each<History>([
    'monthly payment to a person',
    'pharmacy, monthly co-pay',
    'gym, monthly',
    'rent, monthly',
  ])('%s is a likely payment every year, proposed as a bill', (name) => {
    expect(ticked(name)).toBe(SEEDS.length)
    for (const found of (finds.get(name) ?? []).flat()) {
      expect([found.frequency, found.billType]).toEqual(['monthly', 'bill'])
    }
  })
})
