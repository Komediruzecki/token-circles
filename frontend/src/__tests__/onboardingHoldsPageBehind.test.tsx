/**
 * While the setup wizard is open, the app behind it holds still: the document does not scroll, and
 * the shell (sidebar, pages, floating button) is inert, so it takes no focus and no screen reader
 * reads it. Closing the wizard gives all of it back.
 *
 * WHY THIS TEST EXISTS. On an iPhone the Dashboard showed through around the wizard: the spending
 * heatmap under Safari's bottom toolbar, page text under the status bar, and the page scrolled when
 * a finger moved on the wizard's night-sky ground. The wizard is a fixed layer over a shell that
 * stayed scrollable, focusable and painted. Measured in Chromium with an iPhone 13 profile before
 * the fix: one wheel turn on the ground moved the document 600 px, a touch drag 834 px, and 37 of
 * 40 Tab presses landed in the shell behind.
 *
 * The scroll position and the paint are layout, which jsdom has none of; the Playwright spec
 * tests/onboarding-page-behind.spec.ts measures those on a phone.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onboardingDecided } from '../../tests/onboarding-decided'
import { setCurrentProfile, setProfiles, setShowDropdown } from '../core/appStore'
import { onboardingOpen, skipOnboarding, startOnboarding } from '../core/onboardingStore'

// The pages are not under test, and the real Dashboard would cost more to load than all of this.
vi.mock('../router', () => ({ pages: { dashboard: () => null } }))

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const waitLong = { timeout: 10_000 }

/**
 * Is this element, or anything holding it, inert? Solid sets `inert` as a property, which a
 * browser reflects to the attribute (the CSS keys on that) and jsdom keeps as a plain property, so
 * both are read.
 */
function isInert(el: Element | null): boolean {
  for (let node = el; node !== null; node = node.parentElement) {
    if ((node as HTMLElement).inert || node.hasAttribute('inert')) return true
  }
  return false
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  // Pay for the App and wizard imports once, outside any one test's time budget.
  await import('../App')
  await import('../components/onboarding/OnboardingWizard')
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  setShowDropdown(false)
  setProfiles([])
  setCurrentProfile(null)
  document.documentElement.style.overflow = ''
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
  // Local-first, one profile, the wizard already decided so it opens only when a test opens it.
  localStorage.setItem('finance_storage_mode', 'serverless')
  for (const [key, value] of onboardingDecided(['local'])) localStorage.setItem(key, value)
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', JSON.stringify([1]))
  const { getDB } = await import('../core/storage/idb')
  const db = await getDB()
  await db.clear('profiles')
  await db.put('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01T00:00:00.000Z' })

  host = document.createElement('div')
  document.body.appendChild(host)
  const { App } = await import('../App')
  dispose = render(() => <App />, host)
  await vi.waitFor(() => {
    expect(byTestId('profile-dropdown-btn')).not.toBeNull()
  }, waitLong)
})

afterEach(() => {
  if (onboardingOpen()) skipOnboarding()
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.style.overflow = ''
})

async function openWizard() {
  startOnboarding()
  await vi.waitFor(() => {
    expect(byTestId('onboarding-panel')).not.toBeNull()
  }, waitLong)
}

describe('the page behind the setup wizard', () => {
  it('is free before the wizard opens', () => {
    expect(document.documentElement.style.overflow).toBe('')
    expect(isInert(byTestId('profile-dropdown-btn'))).toBe(false)
  })

  it('cannot scroll, take focus or be read while the wizard is open', async () => {
    await openWizard()

    expect(document.documentElement.style.overflow).toBe('hidden')
    // The shell: the sidebar's profile button, the page host, the floating quick-add button.
    expect(isInert(byTestId('profile-dropdown-btn'))).toBe(true)
    expect(isInert(document.querySelector('main'))).toBe(true)
    expect(isInert(document.querySelector('[aria-label="Quick add entry"]'))).toBe(true)
    // The wizard itself stays live.
    expect(isInert(byTestId('onboarding-panel'))).toBe(false)
    expect(isInert(byTestId('onboarding-skip'))).toBe(false)
  })

  it('leaves the confirm dialog the wizard asks through live, and gives everything back on close', async () => {
    await openWizard()

    byTestId('onboarding-skip')!.click()
    const accept = await vi.waitFor(() => {
      const el = byTestId('confirm-accept')
      expect(el).not.toBeNull()
      return el!
    }, waitLong)
    expect(isInert(accept)).toBe(false)
    accept.click()

    await vi.waitFor(() => {
      expect(byTestId('onboarding-panel')).toBeNull()
    }, waitLong)
    expect(document.documentElement.style.overflow).toBe('')
    expect(isInert(byTestId('profile-dropdown-btn'))).toBe(false)
    expect(isInert(byTestId('app-shell'))).toBe(false)
  })

  it('puts back an overflow the page already had, not a blank one', async () => {
    document.documentElement.style.overflow = 'clip'
    await openWizard()
    expect(document.documentElement.style.overflow).toBe('hidden')
    skipOnboarding()
    await vi.waitFor(() => {
      expect(byTestId('onboarding-panel')).toBeNull()
    }, waitLong)
    expect(document.documentElement.style.overflow).toBe('clip')
  })

  it('lets go of the document when the app closes with the wizard still open', async () => {
    await openWizard()
    expect(document.documentElement.style.overflow).toBe('hidden')
    dispose?.()
    dispose = undefined
    expect(document.documentElement.style.overflow).toBe('')
  })
})
