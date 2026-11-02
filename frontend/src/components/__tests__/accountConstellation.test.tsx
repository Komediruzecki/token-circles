/**
 * The constellation's legend names each account's type, and its dot takes that type's colour.
 *
 * The Accounts page hands it each type as the Worker stored it, so a row older versions saved
 * still says `retirement` or `checking`. The legend reads those as the types that replaced them,
 * and a type this build does not have as a plain "Account".
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AccountConstellation from '../AccountConstellation'
import type { ConstellationAccount } from '../AccountConstellation'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  localStorage.setItem('localCurrency', 'EUR')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

const account = (id: number, name: string, type: string): ConstellationAccount => ({
  id,
  name,
  type,
  // Distinct balances: the legend lists accounts largest first.
  balance: 1000 - id * 100,
})

/** Each legend row's account name, type label and dot colour. */
function legend(accounts: ConstellationAccount[]) {
  dispose = render(() => <AccountConstellation accounts={accounts} />, host)
  return Object.fromEntries(
    accounts.map((a) => {
      const row = Array.from(host.querySelectorAll('li')).find((li) =>
        li.textContent?.includes(a.name)
      )!
      return [
        a.name,
        {
          label: row.querySelector('[data-test-id="constellation-type"]')?.textContent,
          color: row.querySelector<HTMLElement>('i')!.style.background,
        },
      ]
    })
  )
}

describe('the constellation legend', () => {
  it('names a type this build does not have "Account", in the plain colour', () => {
    const rows = legend([account(1, 'Everyday', 'giro'), account(2, 'Sock drawer', 'sock_drawer')])
    expect(rows['Sock drawer'].label).toBe('Account')
    expect(rows['Sock drawer'].color).not.toBe(rows.Everyday.color)
  })

  it('names a credit card "Credit Card", in a colour of its own', () => {
    const rows = legend([
      account(1, 'Everyday', 'giro'),
      account(2, 'Visa', 'credit'),
      account(3, 'Sock drawer', 'sock_drawer'),
    ])
    expect(rows.Visa.label).toBe('Credit Card')
    expect(rows.Visa.color).not.toBe(rows.Everyday.color)
    expect(rows.Visa.color).not.toBe(rows['Sock drawer'].color)
  })

  it('names a type v4 renamed as the type that replaced it, in its colour', () => {
    const rows = legend([
      account(1, 'Everyday', 'giro'),
      account(2, 'Brokerage', 'ib'),
      account(3, 'Old current', 'checking'),
      account(4, 'Pension', 'retirement'),
      account(5, 'Funds', 'investment'),
    ])
    expect(rows['Old current']).toEqual(rows.Everyday)
    expect(rows.Pension).toEqual(rows.Brokerage)
    expect(rows.Funds).toEqual(rows.Brokerage)
    expect(rows.Brokerage.label).toBe('Investment')
  })
})
