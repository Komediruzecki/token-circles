/**
 * A loan saved from the Loans dialog, in the body the dialog sends, with the extra payments the
 * Extra payments tab adds, schedules to the figures worked out in closed form: its installment,
 * the extra payments it applies, total interest and payoff date, to the cent. Its row in the list
 * counts every extra payment saved, one after the loan is paid off included.
 *
 * The Worker twin, worker/test/loan-form-parity.test.ts, saves the same bodies through the Worker
 * and requires the same figures. Together they make the two runtimes give a loan the same
 * schedule. This side also checks the two forms send exactly those bodies for what is typed.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FORM_LOANS,
  listedFigures,
  scheduleFigures,
} from '../../../../../shared/fixtures/loanFormParity'
import { extraPaymentBody } from '../../../features/loans/extraPaymentForm'
import { loanBody } from '../../../features/loans/loanForm'
import { getDB } from '../idb'
import { routeApiRequest } from '../localApiRouter'
import type { FormLoan } from '../../../../../shared/fixtures/loanFormParity'

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  await db.clear('profiles')
  await db.clear('loans')
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01' })
})

/** Save the loan as the dialog sends it, then its extra payments as the Extra payments tab does. */
async function save(loan: FormLoan): Promise<number> {
  const created = await send('POST', '/loans', loan.body)
  expect(created.status).toBe(201)
  const { id } = (await created.json()) as { id: number }
  for (const extra of loan.extras) {
    const added = await send('POST', `/loans/${id}/prepayments`, extra.body)
    expect(added.status).toBe(201)
  }
  return id
}

describe('a loan saved from the Loans dialog', () => {
  for (const loan of FORM_LOANS) {
    it(`sends what is typed for ${loan.label} as the bodies the Worker twin saves`, () => {
      expect(loanBody(loan.typed)).toEqual(loan.body)
      for (const extra of loan.extras) expect(extraPaymentBody(extra.typed)).toEqual(extra.body)
    })

    it(`schedules ${loan.label} to the figures worked out by hand`, async () => {
      const id = await save(loan)

      const res = await send('POST', `/loans/${id}/calculate`, {})
      expect(res.status).toBe(200)
      expect(scheduleFigures(await res.json(), loan.expected)).toEqual(loan.expected)
    })

    it(`lists what the extra payments on ${loan.label} come to`, async () => {
      const id = await save(loan)

      const res = await send('GET', '/loans')
      expect(res.status).toBe(200)
      const rows = (await res.json()) as Record<string, unknown>[]
      expect(listedFigures(rows.find((row) => row.id === id)!)).toEqual(loan.listed)
    })
  }
})
