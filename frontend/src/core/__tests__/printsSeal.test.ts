/**
 * The seal (shared/prints/seal.ts), the shares it is drawn from (shares.ts), its words
 * (describe.ts) and the shelf's months (core/prints/shelf.ts). Phase 4 prototype tests: the
 * drawing is the same text every time, a month not tracked stays blank, no amount can reach the
 * drawing or its words, and the first print is the "A year" badge's twelve months.
 */
import { describe, expect, it } from 'vitest'
import { SAMPLE_FROM, SAMPLE_SHA256, SAMPLE_SLOTS } from '../../../../shared/fixtures/sealSample'
import { monthLine, sealSummary } from '../../../../shared/prints/describe'
import { drawSeal, PAPER, THEME } from '../../../../shared/prints/seal'
import { sealShares } from '../../../../shared/prints/shares'
import { addMonths, monthReaching } from '../achievements/months'
import { shelfOf } from '../prints/shelf'
import type { SealSlot } from '../../../../shared/prints/seal'

const sha256 = async (text: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const words = {
  monthName: (ym: string) =>
    new Date(`${ym}-15T00:00:00Z`).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
}

describe('drawSeal', () => {
  it('draws the same text for the same months, every time and in each detail', async () => {
    for (const detail of ['print', 'screen', 'thumb'] as const) {
      const a = drawSeal(SAMPLE_SLOTS, { palette: PAPER, detail })
      expect(drawSeal(SAMPLE_SLOTS, { palette: PAPER, detail })).toBe(a)
      expect(await sha256(a)).toBe(SAMPLE_SHA256[detail])
    }
  })

  it('leaves a month not tracked blank: no petal and no band in its slot', () => {
    const half: SealSlot[] = SAMPLE_SLOTS.map((s, i) => (i < 6 ? s : null))
    const svg = drawSeal(half, { palette: THEME, detail: 'screen', engraveFrom: 0 })
    for (let i = 0; i < 12; i++) {
      expect(svg.includes(`data-slot="${i}"`)).toBe(i < 6)
    }
    const empty = drawSeal(Array(12).fill(null), { palette: THEME, detail: 'screen' })
    expect(empty).not.toContain('seal-petal')
    expect(empty).not.toContain('seal-band')
  })

  it('refuses anything but whole-number shares, so an amount wired in throws', () => {
    const withAmount = (spent: number, kept = 0) =>
      SAMPLE_SLOTS.map((s, i) => (i === 3 ? { spent, kept } : s))
    expect(() => drawSeal(withAmount(4817.29), { palette: PAPER })).toThrow(RangeError)
    expect(() => drawSeal(withAmount(4817), { palette: PAPER })).toThrow(RangeError)
    expect(() => drawSeal(withAmount(50, -250), { palette: PAPER })).toThrow(RangeError)
    expect(() => drawSeal(SAMPLE_SLOTS.slice(0, 11), { palette: PAPER })).toThrow(RangeError)
  })

  it('carries no text, title or description: words go beside it, never inside', () => {
    const svg = drawSeal(SAMPLE_SLOTS, { palette: PAPER, detail: 'print' })
    expect(svg).not.toMatch(/<(text|title|desc|foreignObject)\b/)
  })
})

describe('no amount reaches the seal or its words', () => {
  // Five-digit amounts: no coordinate on a 1200-unit plate has five digits in a row, so any run of
  // five is an amount that got through.
  const money = [
    { spent: 98765.43, kept: 12345.67 },
    { spent: 87654.32, kept: -23456.78 },
    { spent: 76543.21, kept: 34567.89 },
    ...Array.from({ length: 9 }, (_, i) => ({
      spent: 65432.1 + i * 1111.11,
      kept: 45678.9 - i * 2222.22,
    })),
  ]
  const amounts = money.flatMap((m) => [m.spent, m.kept]).map((v) => Math.abs(v))

  it('draws from shares that do not change when every amount is scaled', () => {
    const scaled = money.map((m) => ({ spent: m.spent * 7.31, kept: m.kept * 7.31 }))
    expect(sealShares(scaled)).toEqual(sealShares(money))
  })

  it('leaves no amount in the drawing, at any detail, or in its words', () => {
    const slots = sealShares(money)
    const texts = [
      ...(['print', 'screen', 'thumb'] as const).map((detail) =>
        drawSeal(slots, { palette: PAPER, detail, engraveFrom: 0 })
      ),
      sealSummary(slots, '2025-10', words),
      ...slots.map((_, i) => monthLine(slots, '2025-10', i, words)),
    ]
    for (const text of texts) {
      expect(text).not.toMatch(/\d{5,}/)
      expect(text).not.toMatch(/[€$£]|\bEUR\b/)
      for (const a of amounts) {
        expect(text).not.toContain(a.toFixed(2))
        expect(text).not.toContain(String(Math.trunc(a)))
      }
    }
  })
})

describe('sealShares', () => {
  it('keeps a month that overspent below zero, however little it overspent', () => {
    const [, tiny] = sealShares([
      { spent: 1000, kept: 900 },
      { spent: 1001, kept: -1 },
    ])
    expect(tiny?.kept).toBe(-1)
  })

  it('scales spending to the heaviest month, in proportion', () => {
    const shares = sealShares([{ spent: 2000, kept: 0 }, { spent: 4000, kept: 0 }, null])
    expect(shares).toEqual([{ spent: 50, kept: 0 }, { spent: 100, kept: 0 }, null])
  })
})

describe('the words', () => {
  it('names the months by how they compare and whether they kept money', () => {
    expect(monthLine(SAMPLE_SLOTS, SAMPLE_FROM, 10, words)).toBe(
      'August 2026 spent the most of these 12 months, and more than came in.'
    )
    expect(monthLine(SAMPLE_SLOTS, SAMPLE_FROM, 0, words)).toBe(
      'October 2025 spent the least of these 12 months, and kept money.'
    )
    expect(sealSummary(SAMPLE_SLOTS, SAMPLE_FROM, words)).toBe(
      'A seal of twelve petals in a woven band, October 2025 to September 2026. August 2026 spent the most, October 2025 the least. The band turns copper for March 2026 and August 2026, which each spent more than came in.'
    )
  })
})

describe('shelfOf', () => {
  /** Deterministic sets of tracked months, with gaps, over twelve years. */
  function* trackedSets(): Generator<string[]> {
    let seed = 20261031
    const rnd = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    for (let k = 0; k < 400; k++) {
      const months: string[] = []
      let m = '2014-01'
      for (let i = 0; i < 144; i++) {
        if (rnd() > 0.06 + (k % 5) * 0.02) months.push(m)
        m = addMonths(m, 1)
      }
      yield months
    }
  }

  it('makes the first print the "A year" badge\'s twelve months, for any record', () => {
    for (const tracked of trackedSets()) {
      const reached = monthReaching(tracked, 12)
      const { prints } = shelfOf(tracked)
      if (reached === null) {
        expect(prints).toEqual([])
      } else {
        expect(addMonths(prints[0].from, 11)).toBe(reached)
      }
    }
  })

  it('cuts each run into twelves from its start, and fills the plate from the newest run', () => {
    const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(from, i))
    const shelf = shelfOf([...run('2020-03', 15), ...run('2021-09', 26)])
    expect(shelf.prints.map((p) => p.from)).toEqual(['2020-03', '2021-09', '2022-09'])
    expect(shelf.plate).toEqual({ from: '2023-09', months: 2 })
    expect(shelf.last).toBe('2023-10')
    expect(shelfOf([])).toEqual({ prints: [], plate: null, last: null })
  })
})
