/**
 * The account list as the app reads it (api.getAccounts, the Transactions page, quick entry and
 * Tags), in either storage mode.
 *
 * The reader took only the four types this build has. An account of any other type (the MCP's
 * create_account stored any string, and a later build can add a type) failed the whole list, so
 * every account went missing with it. Now a type this build does not know is kept as it is, and
 * the pages show it as a plain account. A type v4 renamed reads as the type that replaced it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { apiFetch } from '../apiFetch'

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

afterEach(() => {
  apiFetchMock.mockReset()
})

const row = (id: number, name: string, type: string) => ({
  id,
  name,
  type,
  bank_name: '',
  currency: 'EUR',
  balance: 100,
  notes: '',
  profile_id: 1,
  starting_balance: 100,
  starting_date: null,
})

function answer(rows: unknown[]): void {
  apiFetchMock.mockResolvedValue(
    new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
}

describe('api.getAccounts', () => {
  it('loads a list holding a type this build does not know, and keeps the type', async () => {
    answer([row(1, 'Everyday', 'giro'), row(2, 'Car loan', 'loan'), row(3, 'Pot', 'savings')])
    const accounts = await api.getAccounts()
    expect(accounts.map((a) => [a.name, a.type])).toEqual([
      ['Everyday', 'giro'],
      ['Car loan', 'loan'],
      ['Pot', 'savings'],
    ])
  })

  it('reads a type v4 renamed as the type that replaced it', async () => {
    answer([row(1, 'Old', 'checking'), row(2, 'Broker', 'investment')])
    const accounts = await api.getAccounts()
    expect(accounts.map((a) => a.type)).toEqual(['giro', 'ib'])
  })
})

describe("a credit card's limit and rate", () => {
  it('are kept by the reader, and read as none when a row has neither', async () => {
    answer([
      { ...row(1, 'Visa', 'credit'), balance: -350, credit_limit: 2000, credit_rate: 15.9 },
      { ...row(2, 'Everyday', 'giro'), credit_limit: null, credit_rate: null },
      row(3, 'Pot', 'savings'),
    ])
    const accounts = await api.getAccounts()
    expect(accounts.map((a) => [a.name, a.type, a.credit_limit, a.credit_rate])).toEqual([
      ['Visa', 'credit', 2000, 15.9],
      ['Everyday', 'giro', null, null],
      ['Pot', 'savings', undefined, undefined],
    ])
  })
})
