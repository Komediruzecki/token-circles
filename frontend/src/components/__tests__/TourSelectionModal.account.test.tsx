/**
 * The tour menu, signed in: the tours marked Done are the account's (`tours` in
 * `/api/account/state`), read when the menu opens, so a tour finished on another device shows as
 * done here.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { __resetAccountStateForTest, setAccountStateOwner } from '../../core/accountState'
import { toursWriteSettled } from '../../core/spotlightStore'
import TourSelectionModal from '../TourSelectionModal'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'self-hosted')
  // This browser's own list has Budgets done. Signed in, what shows comes from the account.
  localStorage.setItem('finance_spotlight_tours', JSON.stringify({ budgets: true }))
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url, 'http://localhost').pathname
    if (path === '/api/account/state') {
      return json({
        onboarding: null,
        tours: { seen: ['dashboard', 'loans'] },
        getting_started: null,
      })
    }
    return json([])
  })
  __resetAccountStateForTest()
  setAccountStateOwner('account-5')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(async () => {
  dispose?.()
  dispose = undefined
  host.remove()
  await toursWriteSettled()
  __resetAccountStateForTest()
  vi.unstubAllGlobals()
  localStorage.clear()
})

/** The badge on the card for the tour labelled `label`. */
const badge = (label: string) =>
  [...host.querySelectorAll('button')].find((button) => button.textContent?.startsWith(label))
    ?.lastElementChild?.textContent

it("marks the account's finished tours Done once its list arrives", async () => {
  dispose = render(() => <TourSelectionModal />, host)

  await vi.waitFor(() => {
    expect(badge('Dashboard')).toBe('Done')
  })
  expect(badge('Loans')).toBe('Done')
  expect(badge('Budgets')).not.toBe('Done')
  expect(host.textContent).toContain('2/15 tours completed')
})
