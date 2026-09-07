import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import LegalLinks, { PRIVACY_URL, TERMS_URL } from '../LegalLinks'

let host: HTMLDivElement
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  host?.remove()
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
})
