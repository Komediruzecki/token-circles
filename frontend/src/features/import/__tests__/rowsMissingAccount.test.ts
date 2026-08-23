/**
 * Which bank rows the import refuses to process, and therefore which fields have to turn red.
 *
 * The refusal used to be a single line at the top of the page — "Choose a target account for
 * every recognized file" — with nothing on the rows themselves. On a phone that line is above a
 * fold the user is nowhere near by the time they press Process, so the app said no and appeared
 * to do nothing at all.
 *
 * `runBankTransform` and the UI now call this same function, which is the point of extracting it:
 * what is marked red is by construction exactly what the transform refuses on.
 */
import { describe, expect, it } from 'vitest'
import { rowsMissingAccount } from '../importFlow'

const row = (bankId: string | null, targetAccount: string) =>
  ({ bankId, targetAccount }) as Parameters<typeof rowsMissingAccount>[0][number]

describe('rowsMissingAccount', () => {
  it('names the rows that are recognized but have no account', () => {
    expect(
      rowsMissingAccount([
        row('erste', 'Giro'),
        row('pbz', ''),
        row('otp', 'Savings'),
        row('rba', ''),
      ])
    ).toEqual([1, 3])
  })

  it('is empty when every recognized row has one', () => {
    expect(rowsMissingAccount([row('erste', 'Giro'), row('pbz', 'Savings')])).toEqual([])
  })

  it('leaves unrecognized rows alone', () => {
    // The transform skips them, so an account is not required — and marking one red would be an
    // error the user has no way to clear.
    expect(rowsMissingAccount([row(null, ''), row(null, '')])).toEqual([])
  })

  it('reports positions in the full list, not among the recognized ones', () => {
    // The UI indexes rows as rendered. Counting only recognized files would put the red border on
    // the wrong row as soon as one file is unrecognized.
    expect(rowsMissingAccount([row(null, ''), row('erste', ''), row('pbz', 'Giro')])).toEqual([1])
  })

  it('has nothing to say about an empty list', () => {
    expect(rowsMissingAccount([])).toEqual([])
  })
})
