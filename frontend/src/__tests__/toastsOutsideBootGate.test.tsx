/**
 * A toast raised while App still shows its boot screen is drawn.
 *
 * WHY THIS TEST EXISTS. 5.16.1 added a notice for a local-first tab whose database upgrade waits
 * on an older tab: "Close your other Token Circles tabs to finish updating this one." The notice is
 * a toast, and the toast container was rendered inside App, below App's
 * `<Show when={!_isLoading()}>`. The blocked upgrade is what keeps App loading, so the notice was
 * queued and never drawn: the tab showed the boot screen and nothing else, exactly as before the
 * notice existed. The release rehearsal on production builds
 * (frontend/tests/release/s15-two-tab-upgrade.spec.ts) found it; this pins it without them.
 *
 * App is replaced by its boot screen here, which is all of it a blocked tab ever renders.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import appSrc from '../App.tsx?raw'
import { announceUpgradeBlocked, UPGRADE_BLOCKED_CHANNEL } from '../core/storage/connectionNotices'
import { removeToastsByChannel } from '../core/toastStore'
import { Root } from '../Root'

vi.mock('../App', () => ({ App: () => <p>Preparing your orbit…</p> }))

const NOTICE = 'Close your other Token Circles tabs to finish updating this one.'

afterEach(() => {
  removeToastsByChannel(UPGRADE_BLOCKED_CHANNEL)
  document.body.innerHTML = ''
})

describe('toasts outside the boot gate', () => {
  it('draws the blocked-upgrade notice while App shows only its boot screen', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const dispose = render(() => <Root />, host)
    announceUpgradeBlocked()
    expect(host.textContent).toContain('Preparing your orbit…')
    expect(host.textContent).toContain(NOTICE)
    dispose()
  })

  it('App draws no toast container of its own', () => {
    // A second container inside App would draw every toast twice once loading ends.
    expect(appSrc).not.toMatch(/<ToastContainer\b/)
  })
})
