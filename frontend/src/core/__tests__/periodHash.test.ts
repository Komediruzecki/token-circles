/**
 * The focus period rides on the hash of the page (periodStore), and never on the hash of a route
 * that is not a page: #reset-password carries its token, and the sign-in screen reads
 * #forgot-password.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { initPeriodSync } from '../periodStore'

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  stop = undefined
  history.replaceState(null, '', '/')
})

describe('the period on the address', () => {
  it('is written onto the hash of a page', () => {
    history.replaceState(null, '', '/#budgets')
    stop = initPeriodSync()

    expect(window.location.hash).toMatch(/^#budgets\?/)
  })

  it.each(['#reset-password?token=abc', '#forgot-password'])('stays off %s', (hash) => {
    history.replaceState(null, '', `/${hash}`)
    stop = initPeriodSync()

    expect(window.location.hash).toBe(hash)
  })

  it('stays off #forgot-password when the address changes to it', async () => {
    history.replaceState(null, '', '/')
    stop = initPeriodSync()

    const changed = new Promise((r) => {
      window.addEventListener('hashchange', r, { once: true })
    })
    window.location.hash = '#forgot-password'
    await changed

    expect(window.location.hash).toBe('#forgot-password')
  })
})
