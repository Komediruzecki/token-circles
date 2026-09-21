import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiModule from '../api'
import * as apiFetchModule from '../apiFetch'
import { isSyncing, triggerBankSync } from '../bankSyncStore'

describe('bankSyncStore', () => {
  let mockFetch: any
  let toastSpy: any

  beforeEach(() => {
    localStorage.clear()
    toastSpy = vi.spyOn(apiModule, 'toast').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('aborts silently if session is not connected', async () => {
    mockFetch = vi.spyOn(apiFetchModule, 'apiFetch').mockResolvedValue({
      ok: true,
      json: async () => ({ connected: false }),
    } as any)

    await triggerBankSync(false)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('/api/imports/enablebanking/session')
    expect(isSyncing()).toBe(false)
  })

  it('throttles background sync if last sync was recent (< 4h)', async () => {
    const recent = Date.now() - 60 * 60 * 1000 // 1 hour ago
    localStorage.setItem('lastBankSyncTime', recent.toString())

    mockFetch = vi.spyOn(apiFetchModule, 'apiFetch')

    await triggerBankSync(false)
    // Should not even check session
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('force sync bypasses the 4-hour throttle', async () => {
    const recent = Date.now() - 60 * 60 * 1000 // 1 hour ago
    localStorage.setItem('lastBankSyncTime', recent.toString())

    mockFetch = vi.spyOn(apiFetchModule, 'apiFetch').mockImplementation(async (url: string) => {
      if (url === '/api/imports/enablebanking/session') {
        return { ok: true, json: async () => ({ connected: true }) } as any
      }
      if (url === '/api/imports/enablebanking/transactions') {
        return { ok: true, json: async () => ({ success: true, accounts: [] }) } as any
      }
      if (url.startsWith('/api/transactions?')) {
        return { ok: true, json: async () => [] } as any
      }
      if (url === '/api/accounts') {
        return { ok: true, json: async () => [] } as any
      }
      if (url === '/api/categories/mappings') {
        return { ok: true, json: async () => [] } as any
      }
      return { ok: true, json: async () => ({}) } as any
    })

    await triggerBankSync(true)
    expect(mockFetch).toHaveBeenCalledWith('/api/imports/enablebanking/session')
    expect(toastSpy).toHaveBeenCalledWith('Synced 0 new transactions.', 'success')
  })

  it('correctly dedupes existing transactions and maps category by description', async () => {
    const postedTransactions: any[] = []

    mockFetch = vi
      .spyOn(apiFetchModule, 'apiFetch')
      .mockImplementation(async (url: string, opts?: any) => {
        if (url === '/api/imports/enablebanking/session') {
          return { ok: true, json: async () => ({ connected: true }) } as any
        }
        if (url === '/api/imports/enablebanking/transactions') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              accounts: [
                {
                  mapped_account_id: 42,
                  transactions: [
                    {
                      transaction_id: 'tx-existing-1',
                      amount: '15.50',
                      booking_date: '2026-09-01',
                      remittance_information: ['Grocery Store Kaufland'],
                      credit_debit_indicator: 'DBIT',
                    },
                    {
                      transaction_id: 'tx-new-2',
                      amount: '25.00',
                      booking_date: '2026-09-02',
                      remittance_information: ['Grocery Store Kaufland'],
                      credit_debit_indicator: 'DBIT',
                    },
                  ],
                },
              ],
            }),
          } as any
        }
        if (url.startsWith('/api/transactions?')) {
          // Return existing transaction notes containing tx-existing-1
          return {
            ok: true,
            json: async () => [
              {
                id: 1,
                notes: 'Bank TX ID: tx-existing-1 (Imported from bank)',
              },
            ],
          } as any
        }
        if (url === '/api/accounts') {
          return { ok: true, json: async () => [{ id: 10, type: 'giro' }] } as any
        }
        if (url === '/api/categories/mappings') {
          return {
            ok: true,
            json: async () => [
              {
                pattern: 'grocery store kaufland',
                category_id: 99,
              },
            ],
          } as any
        }
        if (url === '/api/transactions' && opts?.method === 'POST') {
          postedTransactions.push(JSON.parse(opts.body))
          return { ok: true, json: async () => ({ id: 100 }) } as any
        }
        return { ok: true, json: async () => ({}) } as any
      })

    await triggerBankSync(true)

    expect(postedTransactions).toHaveLength(1)
    expect(postedTransactions[0]).toMatchObject({
      amount: 25,
      type: 'expense',
      date: '2026-09-02',
      account_id: 42,
      category_id: 99,
      notes: 'Bank TX ID: tx-new-2',
    })
    expect(toastSpy).toHaveBeenCalledWith('Synced 1 new transactions.', 'success')
  })
})
