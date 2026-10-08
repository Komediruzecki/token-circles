/**
 * Editing a loan in cloud mode, where the list row has no rate periods and the form reads them
 * from the loan itself. The form is typed into the moment it opens, so that read must not land
 * over what was typed, and a save made before it lands must not send an empty list of periods:
 * the Worker deletes every stored period it is not sent.
 *
 * Found by the release suite (5.16.0 s2 2.4, cloud): the edit's new principal was saved as the old
 * one, because the read came back after the typing and refilled the whole form.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toLoanRow } from '../loanData'
import type { ListedLoan } from '../loanData'

const api = vi.hoisted(() => ({
  read: null as null | ((value: unknown) => void),
  fail: null as null | ((err: unknown) => void),
  put: vi.fn(async (_path: string, _body: Record<string, unknown>) => ({ ok: true })),
}))

vi.mock('../../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    // The loan's own read, answered when the test says so.
    apiGet: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          api.read = resolve
          api.fail = reject
        })
    ),
    apiPut: api.put,
    apiPost: vi.fn(async () => ({ id: 1 })),
    showToast: vi.fn(),
  }
})

const LISTED: ListedLoan = {
  id: 7,
  name: 'Car loan',
  principal: 12000,
  interest_rate: 4,
  term_months: 48,
  start_date: '2026-01-01',
  profile_id: 1,
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((res) => setTimeout(res, 0))
}

beforeEach(() => {
  api.put.mockClear()
  api.read = null
  api.fail = null
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

async function openEdit() {
  const { default: LoanForm } = await import('../LoanForm')
  const row = toLoanRow(LISTED, '2026-06-15', 1)
  dispose = render(() => <LoanForm loan={row} onClose={() => {}} />, host)
  await settle()
}

const principal = () => host.querySelector<HTMLInputElement>('input[placeholder="15000.00"]')!

async function type(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

async function save() {
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await settle()
}

describe('editing a loan whose rate periods are still loading', () => {
  it('opens filled in, before the loan read answers', async () => {
    await openEdit()
    expect(principal().value).toBe('12000')
    expect(host.querySelector('[data-test-id="loans-form-periods-pending"]')?.textContent).toBe(
      "Loading this loan's rate periods."
    )
  })

  it('keeps what was typed when the periods arrive, and saves both', async () => {
    await openEdit()
    await type(principal(), '15000')
    api.read!({ ...LISTED, rate_periods: [{ rate: 4, start_month: 1, end_month: null }] })
    await settle()

    await save()
    expect(api.put).toHaveBeenCalledTimes(1)
    const [path, body] = api.put.mock.calls[0]
    expect(path).toBe('/api/loans/7')
    expect(body.principal).toBe(15000)
    expect(body.rate_periods).toEqual([{ rate: 4, start_month: 1, end_month: null }])
  })

  it('leaves the stored periods alone when saved before they arrive', async () => {
    await openEdit()
    await type(principal(), '15000')
    await save()
    const [, body] = api.put.mock.calls[0]
    expect(body.principal).toBe(15000)
    expect('rate_periods' in body).toBe(false)
  })

  it('leaves them alone when they cannot be read, and says so', async () => {
    await openEdit()
    api.fail!(new Error('offline'))
    await settle()
    expect(host.querySelector('[data-test-id="loans-form-periods-pending"]')?.textContent).toBe(
      "This loan's rate periods did not load. Saving keeps them as they are."
    )
    await save()
    const [, body] = api.put.mock.calls[0]
    expect('rate_periods' in body).toBe(false)
  })
})
