/**
 * "Copy last month" on the Budgets page leaves every budget the month already has as it is (both
 * runtimes; the contract scenario "last month's budgets are copied to this month, once"), so its
 * toast says how many budgets it copied and how many categories already had one.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiPost, showToast } from '../../core/api'
import { setPage } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { copyLastMonthToast } from '../copyLastMonth'

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiGet: vi.fn(async () => []),
    apiHouseholdGet: vi.fn(async () => []),
    apiPost: vi.fn(async () => ({ ok: true })),
    apiPut: vi.fn(async () => ({ ok: true })),
    apiDelete: vi.fn(async () => ({ ok: true })),
    showToast: vi.fn(),
    api: {
      getCategories: vi.fn(async () => []),
      getAccounts: vi.fn(async () => []),
    },
  }
})

const flush = () => new Promise((r) => setTimeout(r, 0))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  __resetDataVersionsForTest()
  vi.mocked(showToast).mockClear()
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  // April 2026: the copy reads March.
  setPeriod({ mode: 'month', year: 2026, month: 3 })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host?.remove()
  vi.unstubAllGlobals()
})

/** Mounts the Budgets page, presses "Copy last month" with this answer, and returns the toast. */
async function copyAnswering(answer: unknown): Promise<unknown[]> {
  setPage('budgets')
  const { default: Budgets } = await import('../Budgets')
  dispose = render(() => <Budgets />, host)
  await flush()
  vi.mocked(apiPost).mockResolvedValueOnce(answer as never)
  const button = host.querySelector<HTMLButtonElement>('[title^="Copy the budget amounts"]')
  expect(button).not.toBeNull()
  button!.click()
  await flush()
  await flush()
  expect(apiPost).toHaveBeenCalledWith('/api/budgets/duplicate-last', { year: 2026, month: 4 })
  expect(showToast).toHaveBeenCalledTimes(1)
  return vi.mocked(showToast).mock.calls[0]
}

describe('Copy last month', () => {
  it('says how many it copied and how many categories already had a budget', async () => {
    expect(await copyAnswering({ ok: true, count: 1, already_budgeted: 1 })).toEqual([
      'Copied 1 of 2 budgets from March 2026. The other category already had a budget for April 2026 and keeps it.',
      'success',
    ])
  })

  it('says nothing was copied when every category already had one', async () => {
    expect(await copyAnswering({ ok: true, count: 0, already_budgeted: 2 })).toEqual([
      'Nothing copied: every category budgeted in March 2026 already has a budget for April 2026',
      'info',
    ])
  })

  it('passes on why there was nothing to copy', async () => {
    expect(
      await copyAnswering({ ok: false, message: 'No budgets found for previous month' })
    ).toEqual(['No budgets found for previous month', 'info'])
  })
})

describe('copyLastMonthToast', () => {
  it('counts every copy when the month had none of them', () => {
    expect(copyLastMonthToast({ count: 2, already_budgeted: 0 }, '2026-04')).toEqual({
      message: 'Copied 2 budgets from March 2026',
      type: 'success',
    })
    expect(copyLastMonthToast({ count: 1 }, '2026-04').message).toBe(
      'Copied 1 budget from March 2026'
    )
  })

  it('names the categories that kept their own budget, as a number', () => {
    expect(copyLastMonthToast({ count: 2, already_budgeted: 3 }, '2026-04').message).toBe(
      'Copied 2 of 5 budgets from March 2026. The other 3 categories already had budgets for April 2026 and keep them.'
    )
  })

  it('reads January from the December before it', () => {
    expect(copyLastMonthToast({ count: 1, already_budgeted: 0 }, '2026-01').message).toBe(
      'Copied 1 budget from December 2025'
    )
  })
})
