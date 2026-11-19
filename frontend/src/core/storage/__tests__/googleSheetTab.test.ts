/**
 * Local-first reads a Google Sheet's tab by the link alone (review of 19 Nov, finding 11): the
 * tab is the link's gid, or the first tab, in every way it tries, as the Worker reads it. A tab
 * name the page sends back, even the "Sheet1" both runtimes used to answer when they knew none,
 * never reaches Google. Made-up sheet ids and rows only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const CSV = 'Date,Description,Amount\n2026-03-01,Example pay,2500\n'
let asked: string[] = []

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  asked = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      asked.push(input instanceof Request ? input.url : input.toString())
      return Promise.resolve(new Response(CSV, { status: 200 }))
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function readSheet(sheetName: string) {
  const res = await routeApiRequest('/api/import/googlesheet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://docs.google.com/spreadsheets/d/example-sheet-id/edit#gid=0',
      sheetName,
    }),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe('a Google Sheet read local-first', () => {
  it('never sends a tab name to Google, the old placeholder least of all', async () => {
    const { status } = await readSheet('Sheet1')

    expect(status).toBe(200)
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.filter((url) => /[?&]sheet=/.test(url))).toEqual([])
  })

  it('answers no tab name it does not know', async () => {
    const { body } = await readSheet('')

    expect(body).toMatchObject({ headers: ['Date', 'Description', 'Amount'], sheetNames: [] })
    expect(body.selectedSheet).toBe('')
  })
})
