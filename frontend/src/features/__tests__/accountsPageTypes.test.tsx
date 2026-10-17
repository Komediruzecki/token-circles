/**
 * The Accounts page in cloud mode, where each account's type arrives as the Worker stored it.
 *
 * A row older versions saved still says `checking` or `retirement`. The badge's word read it as the
 * type that replaced it, but its colour, the card's icon and the constellation read it raw, so a
 * `retirement` account said "ib" in the plain grey with the plain icon, and "Account" on the map.
 * Every one of them now reads the type through core/accountTypes.ts.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import badgeStyles from '../../components/Badge.module.css'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'

const row = (id: number, name: string, type: string) => ({
  id,
  name,
  type,
  balance: 1000 - id * 100,
  currency: 'EUR',
  bank_name: '',
  starting_balance: 0,
  profile_id: 1,
})

const serverAccounts = [
  row(1, 'Brokerage', 'ib'),
  row(2, 'Pension', 'retirement'),
  row(3, 'Everyday', 'giro'),
  row(4, 'Old current', 'checking'),
  row(5, 'Visa', 'credit'),
]

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiGet: vi.fn(async (path: string) => {
    if (path === '/api/accounts') return serverAccounts.map((a) => ({ ...a }))
    if (path === '/api/profiles') return [{ id: 1, name: 'Me' }]
    return []
  }),
}))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
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
  setPage('accounts')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
})

/** What each card shows of its type: the badge's word and colour, and the icon. */
async function cards() {
  const { default: Accounts } = await import('../Accounts')
  dispose = render(() => <Accounts />, host)
  await vi.waitFor(() => {
    expect(host.querySelectorAll('[data-test-id="account-card"]').length).toBe(5)
  })
  return Object.fromEntries(
    Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="account-card"]'), (card) => {
      const badge = card.querySelector('[data-test-id="account-type"]')!.firstElementChild!
      return [
        card.querySelector('[data-test-id="account-name"]')!.textContent,
        {
          word: badge.textContent,
          className: badge.className,
          icon: card.querySelector('[data-test-id="account-icon"] path')!.getAttribute('d'),
        },
      ]
    })
  )
}

describe('the Accounts page shows a stored type as the app reads it', () => {
  it('shows a type v4 renamed as the type that replaced it: word, colour and icon', async () => {
    const shown = await cards()
    expect(shown.Pension).toEqual(shown.Brokerage)
    expect(shown['Old current']).toEqual(shown.Everyday)
    expect(shown.Everyday.className).toContain(badgeStyles.badgePrimary)
  })

  it('shows a type this build does not have as a plain account', async () => {
    const shown = await cards()
    expect(shown.Visa.word).toBe('account')
    expect(shown.Visa.className).toContain(badgeStyles.badgeDefault)
    expect(shown.Visa.icon).not.toBe(shown.Everyday.icon)
  })

  it("names the type in the constellation's legend the same way", async () => {
    await cards()
    const label = (name: string) =>
      Array.from(host.querySelectorAll('li'))
        .find((li) => li.textContent?.includes(name))
        ?.querySelector('[data-test-id="constellation-type"]')?.textContent
    expect(label('Pension')).toBe('Investment')
    expect(label('Old current')).toBe('Checking')
    expect(label('Visa')).toBe('Account')
  })
})
