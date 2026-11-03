import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LegalLinks, { PRIVACY_URL, TERMS_URL } from '../LegalLinks'

let host: HTMLDivElement
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  host?.remove()
  vi.unstubAllEnvs()
})

describe('LegalLinks', () => {
  it('links Privacy and Terms on the marketing site, in a new tab, without leaking a referrer', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(() => <LegalLinks />, host)
    const links = Array.from(host.querySelectorAll('a'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual([PRIVACY_URL, TERMS_URL])
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
    expect(PRIVACY_URL).toBe('https://about.tokencircles.com/privacy')
    expect(TERMS_URL).toBe('https://about.tokencircles.com/terms')
  })

  it('links to the about site the build names (A20), so dev links to dev', async () => {
    vi.stubEnv('VITE_ABOUT_ORIGIN', 'https://about.example.test')
    vi.resetModules()
    const built = await import('../LegalLinks')
    expect(built.MARKETING_SITE).toBe('https://about.example.test')
    expect(built.PRIVACY_URL).toBe('https://about.example.test/privacy')
    expect(built.TERMS_URL).toBe('https://about.example.test/terms')
  })
})
