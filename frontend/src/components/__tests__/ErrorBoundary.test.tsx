/**
 * ErrorBoundary — the crash modal must not race the quiet chunk-failure reload.
 *
 * A stale-chunk rejection reaches BOTH bootRecovery (which reloads to the new build) and this
 * boundary's global handlers. While that reload is in flight the boundary must stay silent —
 * users reported the flash as "the update crashed the app". Once bootRecovery has stood down
 * (second failure in one session), the modal is the right answer, and its Reload goes through
 * `reloadToLatest`, because a plain reload would be re-served the same dead build by the
 * service worker's precache.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let inFlight = false
const reloadToLatest = vi.fn(async () => undefined)

let host: HTMLDivElement
let dispose: (() => void) | undefined

async function mount() {
  vi.resetModules()
  vi.doMock('@pwa-kit', () => ({ reloadToLatest }))
  vi.doMock('../../core/bootRecovery', async (importOriginal) => {
    const real = (await importOriginal()) as object
    return { ...real, isChunkRecoveryInFlight: () => inFlight }
  })
  const { ErrorBoundary } = await import('../ErrorBoundary')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <ErrorBoundary>
        <div data-testid="app-content" />
      </ErrorBoundary>
    ),
    host
  )
}

function rejectWith(message: string) {
  const event = new Event('unhandledrejection') as Event & { reason: Error }
  event.reason = new Error(message)
  window.dispatchEvent(event)
}

const modal = () => document.body.textContent?.includes('App Crashed') || false
const updateModal = () => document.body.textContent?.includes('Update available') || false

beforeEach(() => {
  inFlight = false
  reloadToLatest.mockClear()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.doUnmock('@pwa-kit')
  vi.doUnmock('../../core/bootRecovery')
  vi.resetModules()
})

describe('stale-chunk rejections', () => {
  it('stays silent while bootRecovery is already reloading', async () => {
    inFlight = true
    await mount()

    rejectWith('Failed to fetch dynamically imported module: /assets/Page-abc.js')

    expect(modal()).toBe(false)
    expect(updateModal()).toBe(false)
  })

  it('shows the update modal once recovery has stood down', async () => {
    inFlight = false
    await mount()

    rejectWith('Failed to fetch dynamically imported module: /assets/Page-abc.js')

    expect(updateModal()).toBe(true)
  })

  it('reloads through reloadToLatest, never a plain location.reload', async () => {
    await mount()
    rejectWith('Failed to fetch dynamically imported module: /assets/Page-abc.js')

    const reload = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Reload')
    expect(reload).toBeDefined()
    reload!.click()
    expect(reloadToLatest).toHaveBeenCalledTimes(1)
  })
})

describe('genuine crashes', () => {
  it('still escalates a non-chunk rejection to the crash modal', async () => {
    inFlight = true // even mid-recovery, an unrelated fatal error must surface
    await mount()

    rejectWith('Cannot read properties of undefined')

    expect(modal()).toBe(true)
  })
})
