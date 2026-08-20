/**
 * Hash-route resolution, including the routes that must NOT hit the 404 catch-all.
 *
 * `#logs` is Settings' diagnostics sub-view and `#reset-password` is a full-screen route App
 * renders before the shell. Sending "anything not in the router map" to the 404 page broke both:
 * the Settings "View Logs" button landed on the error page, and finishing a password reset —
 * which clears the hash — left the user on it.
 */
import { describe, expect, it } from 'vitest'
import { resolvePageFromHash } from '../hashRoute'

const PAGES = new Set(['dashboard', 'transactions', 'budgets', 'settings', 'tags', 'notFound'])
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

  it('keeps Settings on screen for its #logs sub-view', () => {
    expect(resolve('#logs')).toBe('settings')
  })

  it('leaves the active page alone for #reset-password', () => {
    // App renders the reset screen over the shell; changing the page underneath it would strand
    // the user on whatever it changed to once the reset finishes.
    expect(resolve('#reset-password')).toBeNull()
    expect(resolve('#reset-password?token=abc')).toBeNull()
  })
})
