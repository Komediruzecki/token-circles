import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BILL_MESSAGES } from '../../../../shared/billSchema'
import { ApiError } from '../../core/apiError'
import { SubscriptionCatalogModal } from '../SubscriptionCatalogModal'

const apiMocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  showToast: vi.fn(),
}))

// The base currency is read for real: the currency tests set it through localStorage.
vi.mock('../../core/api', async (importOriginal) => ({
  ...apiMocks,
  getLocalCurrency: (await importOriginal<Record<string, unknown>>()).getLocalCurrency,
}))

let host: HTMLDivElement
let dispose: () => void

function mountCatalog() {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => <SubscriptionCatalogModal isOpen={() => true} onClose={vi.fn()} categories={() => []} />,
    host
  )

  const search = host.querySelector<HTMLInputElement>('input[aria-label="Search the catalog"]')!
  input(search, 'Netflix')
  const row = Array.from(host.querySelectorAll<HTMLElement>('[role="button"]')).find((element) =>
    element.textContent?.includes('Netflix')
  )!
  click(row)

  return {
    price: host.querySelector<HTMLInputElement>('input[aria-label="Netflix price"]')!,
    apply: host.querySelector<HTMLButtonElement>('button[aria-label="Apply Netflix price"]')!,
    add: () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === 'Add 1'
      )!,
    total: () =>
      Array.from(host.querySelectorAll<HTMLElement>('span')).find((element) =>
        element.textContent?.includes('selected ·')
      )!,
  }
}

function input(element: HTMLInputElement, value: string) {
  element.focus()
  element.value = value
  element.setSelectionRange(value.length, value.length)
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

beforeEach(() => {
  apiMocks.apiPost.mockReset()
  apiMocks.apiPost.mockResolvedValue({ id: 1 })
  apiMocks.showToast.mockReset()
})

afterEach(() => {
  dispose?.()
  host?.remove()
})

describe('SubscriptionCatalogModal custom prices', () => {
  it('keeps comma-decimal input untouched and preserves the caret while typing', () => {
    const catalog = mountCatalog()
    input(catalog.price, '12,')

    expect(catalog.price.value).toBe('12,')
    expect(catalog.price.selectionStart).toBe(3)
    expect(catalog.total().textContent).toContain('13.99')
  })

  it('commits the draft with the checkmark and submits the committed amount', async () => {
    const catalog = mountCatalog()
    input(catalog.price, '17,49')

    // Drafting does not silently change the committed total.
    expect(catalog.total().textContent).toContain('13.99')
    click(catalog.apply)

    expect(catalog.price.value).toBe('17.49')
    expect(catalog.total().textContent).toContain('17.49')

    click(catalog.add())
    await vi.waitFor(() => {
      expect(apiMocks.apiPost).toHaveBeenCalledWith(
        '/api/bills',
        expect.objectContaining({ name: 'Netflix', amount: 17.49 })
      )
    })
  })

  it('validates malformed drafts instead of coercing them to a wrong amount', async () => {
    const catalog = mountCatalog()
    input(catalog.price, '12,3,4')
    click(catalog.apply)

    expect(catalog.price.value).toBe('12,3,4')
    expect(catalog.price.getAttribute('aria-invalid')).toBe('true')
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/positive price/i)

    click(catalog.add())
    await vi.waitFor(() => {
      expect(apiMocks.showToast).toHaveBeenCalledWith(
        'Fix the highlighted subscription prices',
        'error'
      )
    })
    expect(apiMocks.apiPost).not.toHaveBeenCalled()
  })
})

// A subscription the runtime refuses is named, with the reason it was refused for. The catalog
// said "Some subscriptions could not be added", whatever the reason, and named none.
describe('SubscriptionCatalogModal refusals', () => {
  it('says which subscription was not added, and why', async () => {
    apiMocks.apiPost.mockRejectedValue(
      new ApiError(400, BILL_MESSAGES.amountCents, { amount: BILL_MESSAGES.amountCents })
    )
    const catalog = mountCatalog()

    click(catalog.add())

    await vi.waitFor(() => {
      expect(apiMocks.showToast).toHaveBeenCalledWith(
        `Couldn't add "Netflix". ${BILL_MESSAGES.amountCents}`,
        'error'
      )
    })
    expect(apiMocks.showToast).toHaveBeenCalledTimes(1)
  })
})

describe('SubscriptionCatalogModal currency', () => {
  afterEach(() => {
    localStorage.removeItem('localCurrency')
  })

  it('shows prices in the base currency, which is the currency the bill is saved in', () => {
    localStorage.setItem('localCurrency', 'GBP')
    const catalog = mountCatalog()

    // The price field's prefix, and the running total.
    expect(catalog.price.previousElementSibling?.textContent).toBe('£')
    expect(catalog.total().textContent).toBe('1 selected · £13.99/mo')
  })

  it('shows the code as the prefix where the currency has no shorter symbol', () => {
    localStorage.setItem('localCurrency', 'CHF')
    const catalog = mountCatalog()

    expect(catalog.price.previousElementSibling?.textContent).toBe('CHF')
    expect(catalog.total().textContent).toMatch(/^1 selected · CHF\s13\.99\/mo$/)
  })
})
