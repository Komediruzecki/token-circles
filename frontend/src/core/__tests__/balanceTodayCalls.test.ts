/**
 * Setting an account's balance today through the storage seam (review M2): it reads what is dated
 * after today on the account, then writes the opening balance and the stored balance together.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { balanceToday, setBalanceToday } from '../balanceToday'

const calls = vi.hoisted(() => ({
  get: vi.fn<(url: string) => Promise<unknown>>(),
  put: vi.fn<(url: string, body: unknown) => Promise<unknown>>(),
}))
vi.mock('../api', () => ({
  apiGet: (url: string) => calls.get(url),
  apiPut: (url: string, body: unknown) => calls.put(url, body),
}))

const MAIN = { id: 7, name: 'Main', balance: 3106.37, starting_balance: 1240.5 }

beforeEach(() => {
  calls.get.mockReset()
  calls.put.mockReset()
  calls.put.mockResolvedValue({ message: 'Account updated' })
})

describe("an account's balance today", () => {
  it('asks for what is dated after today on that account, and takes it out', async () => {
    calls.get.mockResolvedValue([
      { date: '2026-11-05', type: 'expense', amount: 40, account_id: 7 },
    ])
    expect(await balanceToday(MAIN, '2026-11-03')).toBeCloseTo(3146.37, 6)
    expect(calls.get).toHaveBeenCalledWith(
      '/api/transactions?account_id=7&startDate=2026-11-04&limit=1000'
    )
  })

  it("is set to the bank's figure with the opening balance moved by as much", async () => {
    calls.get.mockResolvedValue({ rows: [] })
    expect(await setBalanceToday(MAIN, 1240.5, '2026-11-03')).toBe(true)
    expect(calls.put).toHaveBeenCalledWith('/api/accounts/7', {
      starting_balance: -625.37,
      balance: 1240.5,
    })
  })

  it('writes nothing when it reads that already', async () => {
    calls.get.mockResolvedValue([])
    expect(await setBalanceToday(MAIN, 3106.37, '2026-11-03')).toBe(false)
    expect(calls.put).not.toHaveBeenCalled()
  })
})
