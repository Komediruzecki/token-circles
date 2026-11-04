/**
 * The day-7 mail names the prints a year brought in (review M11), counted on the Worker from the
 * tracked months alone (shared/trackedMonths.ts `printsOf`). The app's shelf is the count it must
 * match, for any months: twelve in a row make a print, and a gap starts the next one over.
 */
import { describe, expect, it } from 'vitest'
import { printsOf } from '../../../../shared/trackedMonths'
import { addMonths } from '../achievements/months'
import { shelfOf } from '../prints/windows'

/** `n` months from `from`, as 'YYYY-MM'. */
const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => addMonths(from, i))

describe("the prints the Worker counts, against the app's shelf", () => {
  it('counts twelve in a row as one, and none for eleven', () => {
    expect(printsOf(run('2025-11', 12))).toBe(1)
    expect(printsOf(run('2025-11', 11))).toBe(0)
    expect(printsOf(run('2025-11', 13))).toBe(1)
    expect(printsOf(run('2024-11', 24))).toBe(2)
  })

  it('starts again after a gap, and reads months in any order, repeated', () => {
    const gap = [...run('2023-01', 12), ...run('2024-02', 12)]
    expect(printsOf(gap)).toBe(2)
    expect(printsOf([...run('2025-01', 6), ...run('2025-08', 6)])).toBe(0)
    expect(printsOf([...run('2025-01', 12)].reverse().concat(run('2025-01', 3)))).toBe(1)
    expect(printsOf([])).toBe(0)
  })

  it("agrees with the app's shelf for any months", () => {
    // A fixed generator, so a failure names the same months every run.
    let seed = 7
    const next = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    for (let round = 0; round < 300; round++) {
      const months: string[] = []
      for (let i = 0; i < 72; i++) if (next() < 0.85) months.push(addMonths('2020-01', i))
      expect(printsOf(months), months.join(' ')).toBe(shelfOf(months).prints.length)
    }
  })
})
