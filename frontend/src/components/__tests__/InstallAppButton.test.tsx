/**
 * InstallAppButton — three browsers, three different right answers.
 *
 * The one that matters is silence: a browser that never fires `beforeinstallprompt` and is not
 * iOS gets nothing at all. A dead "Install" button teaches the user the feature is broken rather
 * than unavailable, and it would show on every desktop Firefox and every already-installed window.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const toasts: { message: string; type: string }[] = []

let installable = false
let ios = false
let outcome: 'accepted' | 'dismissed' | 'unavailable' = 'accepted'
let prompts = 0

async function mount() {
  vi.resetModules()
  vi.doMock('@pwa-kit', () => ({
    canInstall: () => installable,
    needsIosInstallHint: () => ios,
    promptInstall: () => {
      prompts += 1
      return Promise.resolve(outcome)
    },
  }))
  vi.doMock('../../core/api', () => ({
    toast: (message: string, type = 'info') => toasts.push({ message, type }),
  }))
  const { InstallAppButton } = await import('../InstallAppButton')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <InstallAppButton />, host)
}

const block = () => host.querySelector('[data-testid="install-app"]')
const button = () => host.querySelector<HTMLButtonElement>('[data-testid="install-app-button"]')
const iosHint = () => host.querySelector('[data-testid="install-app-ios-hint"]')
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  toasts.length = 0
  prompts = 0
  installable = false
  ios = false
  outcome = 'accepted'
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.doUnmock('@pwa-kit')
  vi.doUnmock('../../core/api')
  vi.resetModules()
})

describe('when the browser can install', () => {
  beforeEach(() => {
    installable = true
  })

  it('offers the button', async () => {
    await mount()

    expect(button()).not.toBeNull()
    expect(iosHint()).toBeNull()
  })

  it('opens the sheet once, however many times it is clicked', async () => {
    let release!: (v: 'accepted') => void
    vi.resetModules()
    vi.doMock('@pwa-kit', () => ({
      canInstall: () => true,
      needsIosInstallHint: () => false,
      promptInstall: () => {
        prompts += 1
        return new Promise((r) => (release = r as (v: 'accepted') => void))
      },
    }))
    vi.doMock('../../core/api', () => ({ toast: () => {} }))
    const { InstallAppButton } = await import('../InstallAppButton')
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(() => <InstallAppButton />, host)

    button()!.click()
    await flush()
    button()!.click()
    button()!.click()
    release('accepted')
    await flush()

    expect(prompts).toBe(1)
  })

  it('says so when the browser refuses to open the sheet at all', async () => {
    outcome = 'unavailable'
    await mount()

    button()!.click()
    await flush()

    expect(toasts).toEqual([
      { message: 'Your browser did not offer the install sheet', type: 'error' },
    ])
  })

  it('stays quiet when the user simply closes the sheet', async () => {
    outcome = 'dismissed'
    await mount()

    button()!.click()
    await flush()

    // Nothing went wrong — the user opened a sheet and closed it.
    expect(toasts).toEqual([])
  })
})

describe('on iOS, where there is no install API', () => {
  it('explains the Share menu instead of offering a button that cannot work', async () => {
    ios = true
    await mount()

    expect(button()).toBeNull()
    expect(iosHint()?.textContent).toContain('Add to Home Screen')
  })
})

describe('everywhere else', () => {
  it('renders nothing at all', async () => {
    await mount()

    expect(block()).toBeNull()
  })
})
