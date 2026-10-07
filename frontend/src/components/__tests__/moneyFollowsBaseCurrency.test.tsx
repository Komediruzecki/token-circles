/**
 * Amounts are shown in the base currency.
 *
 * These components formatted money with a currency code written into them: euros in the heatmap
 * tooltip and the rent-or-buy calculator, dollars in the recurring list. A profile keeping its
 * books in pounds saw another currency's symbol on its own numbers. The subscription catalog and
 * the auto-categorize modal have the same cases in their own test files.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { currencySymbol } from '../../core/currencies'
import RentBuyCalculator from '../../features/RentBuyCalculator'
import D3HeatmapChart from '../D3HeatmapChart'
import RecurringSection from '../RecurringSection'

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    api: {
      getRecurring: async () => [
        {
          id: 1,
          description: 'Rent',
          amount: 500,
          type: 'expense',
          frequency: 'monthly',
          day_of_month: 1,
          next_date: '2026-10-01',
          category_id: null,
          account_id: null,
          transfer_account_id: null,
          notes: null,
        },
      ],
    },
  }
})

// Canvas charts do not draw in jsdom, and the amounts under test are in the summary cards.
vi.mock('../Chart', () => ({ default: () => null }))

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

beforeEach(() => {
  localStorage.setItem('localCurrency', 'GBP')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  localStorage.removeItem('localCurrency')
  vi.unstubAllGlobals()
})

describe('money follows the base currency', () => {
  it('the recurring list shows a rule in the base currency', async () => {
    setPage('transactions')
    dispose = render(() => <RecurringSection categories={[]} accounts={[]} />, host)
    await settle()
    host.querySelector<HTMLElement>('[class*="sectionHeader"]')!.click()
    await settle()

    const amount = host.querySelector('[class*="itemAmount"]')
    expect(amount?.textContent).toBe('-£500.00')
  })

  it('the heatmap tooltip shows a day in the base currency', async () => {
    // The chart re-renders on resize; jsdom has no ResizeObserver.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    dispose = render(
      () => <D3HeatmapChart data={new Map([['2026-03-14', 12.5]])} year={2026} type="expense" />,
      host
    )

    // d3 is imported on first render; the cells appear once it has loaded.
    const cell = await vi.waitFor(() => {
      const found = [...host.querySelectorAll('rect.cell')].find((el) => {
        const day = (el as unknown as { __data__?: Date }).__data__
        return day?.getMonth() === 2 && day.getDate() === 14
      })
      expect(found, 'no cell for 14 March').toBeDefined()
      return found!
    })
    cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(document.getElementById('heatmap-tooltip')?.textContent).toBe(
      'Mar 14, 2026: £12.50 expense'
    )
  })

  it('the rent-or-buy calculator shows its results in the base currency', async () => {
    dispose = render(() => <RentBuyCalculator />, host)
    await settle()

    const rentPaid = host.querySelector('[data-test-id="total-rent-paid"]')
    expect(rentPaid, 'the calculator shows no results on open').not.toBeNull()
    expect(rentPaid!.textContent).toMatch(/Total Rent Paid£[\d,]+\.\d\d$/)
  })

  it('a currency passed to the calculator still wins over the base currency', async () => {
    dispose = render(() => <RentBuyCalculator currency="CHF" />, host)
    await settle()

    expect(host.querySelector('[data-test-id="total-rent-paid"]')?.textContent).toMatch(
      /Total Rent PaidCHF\s[\d,]+\.\d\d$/
    )
  })
})

describe('currencySymbol', () => {
  it('is the symbol where the locale has one, and the code where it does not', () => {
    expect(currencySymbol('GBP', 'en-US')).toBe('£')
    expect(currencySymbol('EUR', 'en-US')).toBe('€')
    expect(currencySymbol('CHF', 'en-US')).toBe('CHF')
  })

  it('falls back to the code for a code Intl rejects', () => {
    expect(currencySymbol('not-a-code')).toBe('not-a-code')
  })
})
