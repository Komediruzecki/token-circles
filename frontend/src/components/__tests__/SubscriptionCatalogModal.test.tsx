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
const onClose = vi.fn()

/** Choose the catalog's `name` token: search for it and click it. */
function choose(name: string) {
  const search = host.querySelector<HTMLInputElement>('input[aria-label="Search the catalog"]')!
  input(search, name)
  const row = Array.from(host.querySelectorAll<HTMLElement>('[role="button"]')).find(
    (element) => element.querySelector('[class*="name"]')?.textContent === name
  )!
  click(row)
}

function mountCatalog() {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => <SubscriptionCatalogModal isOpen={() => true} onClose={onClose} categories={() => []} />,
    host
  )

  choose('Netflix')

  return {
    price: host.querySelector<HTMLInputElement>('input[aria-label="Netflix price"]')!,
    apply: host.querySelector<HTMLButtonElement>('button[aria-label="Apply Netflix price"]')!,
    add: () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
        /^Add \d+$/.test(button.textContent?.trim() ?? '')
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
  onClose.mockReset()
})

/** The words under a price field, through its aria-describedby. */
const describedBy = (element: HTMLElement): string =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const notice = () => host.querySelector('[data-test-id="catalog-notice"]')?.textContent ?? ''

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

  it("says what is wrong with a malformed draft under the token, in the bill rules' words", () => {
    const catalog = mountCatalog()
    input(catalog.price, '12,3,4')
    catalog.apply.focus()
    click(catalog.apply)

    expect(catalog.price.value).toBe('12,3,4')
    expect(catalog.price.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(catalog.price)).toBe(BILL_MESSAGES.amountNumber)
    expect(document.activeElement).toBe(catalog.price)
  })

  it('marks a price of zero when Add is pressed, focuses it, and sends nothing', async () => {
    const catalog = mountCatalog()
    input(catalog.price, '0')
    catalog.add().focus()

    click(catalog.add())
    await vi.waitFor(() => {
      expect(describedBy(catalog.price)).toBe(BILL_MESSAGES.amountPositive)
    })
    expect(document.activeElement).toBe(catalog.price)
    expect(apiMocks.apiPost).not.toHaveBeenCalled()
    expect(apiMocks.showToast).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes a mark away with the token when it is unchosen, and leaves none in the notice', async () => {
    const catalog = mountCatalog()
    input(catalog.price, '0')
    click(catalog.add())
    await vi.waitFor(() => {
      expect(catalog.price.getAttribute('aria-invalid')).toBe('true')
    })

    choose('Netflix')

    expect(host.querySelector('input[aria-label="Netflix price"]')).toBeNull()
    expect(notice()).toBe('')
  })

  it('keeps Enter in the search and in a price from adding the batch', () => {
    const catalog = mountCatalog()
    const enter = () =>
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search the catalog"]')!

    const inSearch = enter()
    search.dispatchEvent(inSearch)
    const inPrice = enter()
    catalog.price.dispatchEvent(inPrice)

    // A browser submits a form on Enter in a text field unless the keydown is cancelled.
    expect(inSearch.defaultPrevented).toBe(true)
    expect(inPrice.defaultPrevented).toBe(true)
  })

  it('takes the mark away once the price is fixed', async () => {
    const catalog = mountCatalog()
    input(catalog.price, '0')
    click(catalog.add())
    await vi.waitFor(() => {
      expect(catalog.price.getAttribute('aria-invalid')).toBe('true')
    })

    input(catalog.price, '9,99')

    expect(catalog.price.getAttribute('aria-invalid')).toBeNull()
  })
})

// A subscription the runtime refuses stays chosen, with the reason it was refused for: under its
// price when the price is the reason, in the notice, naming it, when it is not. The catalog said
// "Some subscriptions could not be added", whatever the reason, named none, and closed.
describe('SubscriptionCatalogModal refusals', () => {
  it("marks a price the runtime refuses under its token, in the runtime's words", async () => {
    apiMocks.apiPost.mockRejectedValue(
      new ApiError(400, BILL_MESSAGES.amountCents, { amount: BILL_MESSAGES.amountCents })
    )
    const catalog = mountCatalog()

    click(catalog.add())

    await vi.waitFor(() => {
      expect(describedBy(catalog.price)).toBe(BILL_MESSAGES.amountCents)
    })
    expect(catalog.price.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(catalog.price)
    expect(apiMocks.showToast).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('names a subscription refused for what no price can fix, and adds the rest', async () => {
    apiMocks.apiPost.mockImplementation((_url: string, body: { name: string }) =>
      body.name === 'Spotify'
        ? Promise.reject(
            new ApiError(400, BILL_MESSAGES.category, { category_id: BILL_MESSAGES.category })
          )
        : Promise.resolve({ id: 1 })
    )
    const catalog = mountCatalog()
    choose('Spotify')

    click(catalog.add())

    await vi.waitFor(() => {
      expect(notice()).toBe(`Couldn't add "Spotify". ${BILL_MESSAGES.category}`)
    })
    expect(apiMocks.showToast).toHaveBeenCalledWith('1 subscription added', 'success')
    expect(apiMocks.showToast).toHaveBeenCalledTimes(1)
    // Netflix was added and is no longer chosen; Spotify is, to try again.
    expect(host.querySelector('input[aria-label="Netflix price"]')).toBeNull()
    expect(host.querySelector('input[aria-label="Spotify price"]')).not.toBeNull()
    expect(catalog.add().textContent?.trim()).toBe('Add 1')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes once everything chosen was added', async () => {
    const catalog = mountCatalog()

    click(catalog.add())

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(apiMocks.showToast).toHaveBeenCalledWith('1 subscription added', 'success')
    expect(notice()).toBe('')
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
