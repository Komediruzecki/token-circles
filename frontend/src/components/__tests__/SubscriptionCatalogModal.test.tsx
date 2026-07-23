import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionCatalogModal } from '../SubscriptionCatalogModal'

const apiMocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../core/api', () => apiMocks)

let host: HTMLDivElement
let dispose: () => void

function mountCatalog() {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <SubscriptionCatalogModal
        isOpen={() => true}
        onClose={vi.fn()}
        categories={() => []}
        onAdded={vi.fn()}
      />
    ),
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
