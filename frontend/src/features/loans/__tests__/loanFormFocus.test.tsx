/**
 * The loan form takes focus when it opens and gives it back when it shuts.
 *
 * The form is put on the page long after the page loaded, and the browser applies `autofocus`
 * only while a page loads: the name field's `autofocus` left focus on the button that opened the
 * form, behind the dialog. So the form focuses its first field itself, and when it shuts, focus
 * goes back to the button that opened it (utils/returnFocus.ts). Opened at its rate periods (the
 * Extra payments tab's "Edit rates"), it focuses the first rate field instead, where it scrolled.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toLoanRow } from '../loanData'
import type { ListedLoan } from '../loanData'
import type { FormState } from '../LoanForm'

vi.mock('../../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiGet: vi.fn(() => new Promise(() => {})),
    apiPut: vi.fn(async () => ({ ok: true })),
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
  rate_periods: [{ rate: 4, start_month: 1, end_month: null }],
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
const [state, setState] = createSignal<FormState | null>(null)

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((res) => setTimeout(res, 0))
}

beforeEach(async () => {
  setState(null)
  host = document.createElement('div')
  document.body.appendChild(host)
  // jsdom has no scrollIntoView; the form scrolls its rate periods into view with it.
  Element.prototype.scrollIntoView = vi.fn()
  const { FormHost } = await import('../LoanForm')
  dispose = render(
    () => (
      <>
        <button type="button" data-test-id="opener">
          Open
        </button>
        <FormHost state={state()} onClose={() => setState(null)} />
      </>
    ),
    host
  )
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

const opener = () => host.querySelector<HTMLButtonElement>('[data-test-id="opener"]')!
const dialog = () => host.querySelector<HTMLElement>('[data-test-id="loans-modal"]')
const nameField = () => host.querySelector<HTMLInputElement>('input[placeholder^="e.g., Auto"]')

async function openWith(next: FormState) {
  opener().focus()
  setState(next)
  await settle()
}

async function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
}

describe('the loan form and focus', () => {
  it('focuses the name when Add a loan opens, and the button that opened it when it shuts', async () => {
    await openWith({ loan: null })
    expect(dialog()).not.toBeNull()
    expect(document.activeElement).toBe(nameField())

    await pressEscape()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(opener())
  })

  it('does the same for Edit, shut with its Cancel', async () => {
    await openWith({ loan: toLoanRow(LISTED, '2026-06-15', 1) })
    expect(document.activeElement).toBe(nameField())
    expect(nameField()!.value).toBe('Car loan')

    const cancel = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')
    cancel!.click()
    await settle()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(opener())
  })

  it('opened at its rate periods, focuses the first rate field', async () => {
    await openWith({ loan: toLoanRow(LISTED, '2026-06-15', 1), focusRates: true })
    const rate = host.querySelector<HTMLInputElement>(
      '[data-test-id="loans-form-rate-period"] input[placeholder="Rate %"]'
    )
    expect(rate).not.toBeNull()
    expect(document.activeElement).toBe(rate)
  })

  it('leaves focus alone when it shuts after someone moved it elsewhere', async () => {
    await openWith({ loan: null })
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    setState(null)
    await settle()
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })
})
