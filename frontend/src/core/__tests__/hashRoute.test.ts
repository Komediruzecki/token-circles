/**
 * Hash-route resolution, including the routes that must NOT hit the 404 catch-all.
 *
 * `#logs` is Settings' diagnostics sub-view and `#reset-password` is a full-screen route App
 * renders before the shell. Sending "anything not in the router map" to the 404 page broke both:
 * the Settings "View Logs" button landed on the error page, and finishing a password reset —
 * which clears the hash — left the user on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePageFromHash, takeHashFlag } from '../hashRoute'

const PAGES = new Set([
  'dashboard',
  'transactions',
  'budgets',
  'settings',
  'tags',
  'loans',
  'progress',
  'notFound',
])
const isPage = (name: string) => PAGES.has(name)
const resolve = (hash: string) => resolvePageFromHash(hash, isPage)

describe('resolvePageFromHash', () => {
  it('selects a registered page', () => {
    expect(resolve('#transactions')).toBe('transactions')
    expect(resolve('transactions')).toBe('transactions') // with or without the '#'
  })

  it('ignores a query suffix', () => {
    expect(resolve('#transactions?tag=3')).toBe('transactions')
  })

  it('sends an empty hash to the dashboard, however it is spelled', () => {
    expect(resolve('')).toBe('dashboard')
    expect(resolve('#')).toBe('dashboard')
  })

  it('sends a genuinely unknown fragment to the 404 page', () => {
    expect(resolve('#does-not-exist')).toBe('notFound')
    expect(resolve('#transactionz')).toBe('notFound')
  })

  it('selects Loans for a loan of its own, with or without a tab and a query', () => {
    // The Loans page reads the rest of the path, `#loans/<id>/<tab>`, to pick the loan.
    expect(resolve('#loans')).toBe('loans')
    expect(resolve('#loans/12')).toBe('loans')
    expect(resolve('#loans/12/compare')).toBe('loans')
    expect(resolve('#loans/12/compare?b=one-payment.10000.12.lower&period=2026-10')).toBe('loans')
    expect(resolve('#loans/')).toBe('loans')
    // An id the page does not know is the page's own not-found, not the app's 404.
    expect(resolve('#loans/abc/schedule')).toBe('loans')
  })

  it("selects Progress for a circle's own view", () => {
    expect(resolve('#progress/4')).toBe('progress')
    expect(resolve('#progress/4?period=2026-10')).toBe('progress')
    // A circle that is not 1 to 7 is Progress's to show as the page.
    expect(resolve('#progress/9')).toBe('progress')
  })

  it('sends a path under a page that has no views below it to the 404 page', () => {
    expect(resolve('#transactions/5')).toBe('notFound')
    expect(resolve('#loanz/12')).toBe('notFound')
    expect(resolve('#/loans')).toBe('notFound')
  })

  it('keeps Settings on screen for its #logs sub-view', () => {
    expect(resolve('#logs')).toBe('settings')
  })

  it('leaves the active page alone for #reset-password', () => {
    // App renders the reset screen over the shell; changing the page underneath it would strand
    // the user on whatever it changed to once the reset finishes.
    expect(resolve('#reset-password')).toBeNull()
    expect(resolve('#reset-password?token=abc')).toBeNull()
  })

  it('leaves the active page alone for #forgot-password, which the sign-in screen reads', () => {
    // The "already has an account" mail links there. Signed in, the app stays where it is
    // instead of showing the 404 page.
    expect(resolve('#forgot-password')).toBeNull()
  })
})

describe('takeHashFlag', () => {
  afterEach(() => {
    history.replaceState(null, '', '#')
  })

  it("answers a link's flag once, and takes it off the address without a hashchange", () => {
    history.replaceState(null, '', '#bills?scan=1&period=2026-09')
    const changes = vi.fn()
    window.addEventListener('hashchange', changes)

    expect(takeHashFlag('bills', 'scan')).toBe(true)
    expect(window.location.hash).toBe('#bills?period=2026-09')
    expect(takeHashFlag('bills', 'scan')).toBe(false)

    history.replaceState(null, '', '#bills?scan=1')
    expect(takeHashFlag('bills', 'scan')).toBe(true)
    expect(window.location.hash).toBe('#bills')

    window.removeEventListener('hashchange', changes)
    expect(changes).not.toHaveBeenCalled()
  })

  it("leaves another page's flag, and a flag with another value, where they are", () => {
    history.replaceState(null, '', '#transactions?scan=1')
    expect(takeHashFlag('bills', 'scan')).toBe(false)
    expect(window.location.hash).toBe('#transactions?scan=1')

    history.replaceState(null, '', '#bills?scan=yes')
    expect(takeHashFlag('bills', 'scan')).toBe(false)
    expect(window.location.hash).toBe('#bills?scan=yes')
  })
})
