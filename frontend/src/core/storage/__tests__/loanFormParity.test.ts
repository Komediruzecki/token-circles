/**
 * A loan saved from the Loans dialog, in the body the dialog sends, schedules to the figures worked
 * out in closed form: its installment, total interest and payoff date, to the cent.
 *
 * The Worker twin, worker/test/loan-form-parity.test.ts, saves the same bodies through the Worker
 * and requires the same figures. Together they make the two runtimes give a loan the same
 * schedule. This side also checks the dialog sends exactly those bodies for what is typed.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { FORM_LOANS, scheduleFigures } from '../../../../../shared/fixtures/loanFormParity'
import { loanBody } from '../../../features/loans/loanForm'
import { getDB } from '../idb'
import { routeApiRequest } from '../localApiRouter'

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

describe('a loan saved from the Loans dialog', () => {
  for (const loan of FORM_LOANS) {
    it(`sends what is typed for ${loan.label} as the body the Worker twin saves`, () => {
      expect(loanBody(loan.typed)).toEqual(loan.body)
    })

    it(`schedules ${loan.label} to the figures worked out by hand`, async () => {
      const created = await send('POST', '/loans', loan.body)
      expect(created.status).toBe(201)
      const { id } = (await created.json()) as { id: number }

      const res = await send('POST', `/loans/${id}/calculate`, {})
      expect(res.status).toBe(200)
      expect(scheduleFigures(await res.json(), loan.expected)).toEqual(loan.expected)
    })
  }
})
