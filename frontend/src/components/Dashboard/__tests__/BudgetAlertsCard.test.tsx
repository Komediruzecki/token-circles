/**
 * A refetch of the budget alerts keeps the alerts on screen.
 *
 * The card follows every budget write and every resume now — transaction and category writes
 * reach it through the `budgets` fan-out — so it refetches far more often than the once per
 * profile switch it used to. It showed "Loading..." for as long as any fetch was in flight, so
 * every one of those blanked the card. It reads `.latest` instead, which holds the last alerts
 * until the new ones arrive, and without re-suspending the page's <Suspense> boundary.
 */
import { Suspense } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../../../core/appStore'
import { __resetDataVersionsForTest, invalidateEntity } from '../../../core/dataVersions'
import BudgetAlertsCard from '../BudgetAlertsCard'

interface Alert {
  categoryName: string
  categoryColor: string
  budgetAmount: number
  spent: number
  remaining: number
  percentage: number
  status: string
}

const alert = (categoryName: string): Alert => ({
  categoryName,
  categoryColor: '#ef4444',
  budgetAmount: 100,
  spent: 90,
  remaining: 10,
  percentage: 90,
  status: 'warning',
})

/** Each read waits here until the test answers it. */
let answers: ((alerts: Alert[]) => void)[] = []

vi.mock('../../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiHouseholdGet: vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push((alerts) => {
            resolve({ alerts })
          })
        })
    ),
  }
})

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  __resetDataVersionsForTest()
  answers = []
  setPage('dashboard')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

/** The card inside a Suspense boundary, as the page host renders every page. */
async function mountCard() {
  dispose = render(
    () => (
      <Suspense fallback={<p data-test-id="page-fallback">Loading page</p>}>
        <BudgetAlertsCard />
      </Suspense>
    ),
    host
  )
  await settle()
  answers.shift()!([alert('Groceries')])
  await settle()
}

const pageFallback = () => host.querySelector('[data-test-id="page-fallback"]')

describe('the budget alerts card, while it refetches', () => {
  it.each([
    [
      'a budget write',
      () => {
        invalidateEntity('budgets')
      },
    ],
    [
      'a profile switch',
      () => {
        bumpProfileVersion()
      },
    ],
  ])('keeps the last alerts on screen for %s', async (_, refetch) => {
    await mountCard()
    expect(host.textContent).toContain('Groceries')

    refetch()
    await settle()
    // The new alerts have been asked for and have not arrived.
    expect(answers).toHaveLength(1)
    expect(pageFallback()).toBeNull()
    expect(host.textContent).not.toContain('Loading')
    expect(host.textContent).toContain('Groceries')

    answers.shift()!([alert('Rent')])
    await settle()
    expect(host.textContent).toContain('Rent')
    expect(host.textContent).not.toContain('Groceries')
  })
})
