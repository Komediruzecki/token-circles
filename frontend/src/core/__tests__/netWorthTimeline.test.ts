import { describe, expect, it } from 'vitest'
import { netWorthTimeline } from '../../../../shared/netWorthTimeline'

const GIRO = 1
const SAVINGS = 2

describe('netWorthTimeline', () => {
  it("counts each account's latest balance on or before the day", () => {
    expect(
      netWorthTimeline([
        { account: GIRO, day: '2026-10-01', id: 1, balance: 100 },
        { account: SAVINGS, day: '2026-10-01', id: 2, balance: 900 },
        // Only Giro has a balance on the 5th: Savings still holds 900.
        { account: GIRO, day: '2026-10-05', id: 3, balance: 250 },
      ])
    ).toEqual([
      { date: '2026-10-01', net_worth: 1000 },
      { date: '2026-10-05', net_worth: 1150 },
    ])
  })

  it('takes the balance recorded last when an account has two on one day', () => {
    expect(
      netWorthTimeline([
        { account: GIRO, day: '2026-10-01', id: 7, balance: 175 },
        { account: GIRO, day: '2026-10-01', id: 4, balance: 150 },
        { account: SAVINGS, day: '2026-10-01', id: 5, balance: 700 },
      ])
    ).toEqual([{ date: '2026-10-01', net_worth: 875 }])
  })

  it('counts an account only from its first balance on', () => {
    expect(
      netWorthTimeline([
        { account: SAVINGS, day: '2026-10-03', id: 2, balance: 50 },
        { account: GIRO, day: '2026-10-01', id: 9, balance: 100 },
      ])
    ).toEqual([
      { date: '2026-10-01', net_worth: 100 },
      { date: '2026-10-03', net_worth: 150 },
    ])
  })

  it('works each day out to the cent, and leaves out a snapshot with no day', () => {
    expect(
      netWorthTimeline([
        { account: GIRO, day: '2026-10-01', id: 1, balance: 0.1 },
        { account: SAVINGS, day: '2026-10-01', id: 2, balance: 0.2 },
        { account: GIRO, day: '', id: 3, balance: 1000 },
      ])
    ).toEqual([{ date: '2026-10-01', net_worth: 0.3 }])
  })

  it('has no points without balances', () => {
    expect(netWorthTimeline([])).toEqual([])
  })
})
