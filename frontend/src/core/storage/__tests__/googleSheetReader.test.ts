/**
 * Local-first reads a Google Sheet from the browser (handlers/importFlow.ts importGoogleSheet). It
 * starts every direct way in at once and takes the first that works, in order. A way that fails
 * after an earlier one has answered is a failure no one is waiting for any more, and is not left
 * as an unhandled rejection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importGoogleSheet } from '../handlers/importFlow'

const SHEET = 'https://docs.google.com/spreadsheets/d/ledger-sheet/edit'
const CSV = 'Date,Amount,Description\n2026-08-01,-5.00,Coffee\n'

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason)
}

beforeEach(() => {
  unhandled = []
  process.on('unhandledRejection', onUnhandled)
})

afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
  vi.unstubAllGlobals()
})

describe("local-first's Google Sheet reader", () => {
  it('takes the first way in that works, and leaves no rejection behind', async () => {
    const failLater: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input.includes('/pub?')) return Promise.resolve(new Response(CSV))
        // The other ways in fail, once the first has answered.
        return new Promise<Response>((_, reject) => {
          failLater.push(() => {
            reject(new TypeError('Failed to fetch'))
          })
        })
      })
    )

    const res = await importGoogleSheet({ url: SHEET })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      headers: ['Date', 'Amount', 'Description'],
      rows: [['2026-08-01', '-5.00', 'Coffee']],
    })

    expect(failLater).toHaveLength(2)
    for (const fail of failLater) fail()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(unhandled).toEqual([])
  })
})
