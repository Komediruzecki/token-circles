/**
 * The console is a live feed, not a replay.
 *
 * flushLogs() merges the buffer with everything already in storage — and then printed the WHOLE
 * merged array to the console. initLogging() calls it on boot, so every reload re-emitted up to
 * 500 historical errors: timestamps hours apart arriving in one burst, each carrying the stack of
 * the flush that reprinted them rather than of the call that failed. It reads exactly like the app
 * is making those failing requests right now, and reloading never clears it — which sent a real
 * investigation after login-screen requests that had happened once, hours earlier, in a storage
 * mode the app was no longer in.
 *
 * Storage exists for the in-app LogViewer. The console gets each entry once, when it happens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'app_logs'

const storedError = (message: string, timestamp: string) => ({
  timestamp,
  level: 'error' as const,
  message,
  details: { endpoint: '/categories', method: 'GET' },
  component: 'ApiClient',
})

/** Two errors from earlier visits, hours apart — the shape that made the burst so convincing. */
const history = [
  storedError('API Request Failed', '2026-08-31T19:55:53.000Z'),
  storedError('API Request Failed', '2026-08-31T16:56:29.000Z'),
]

let consoleError: ReturnType<typeof vi.spyOn>
let consoleWarn: ReturnType<typeof vi.spyOn>
let consoleInfo: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('logger console output', () => {
  it('does not replay stored errors to the console on boot', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
    const { initLogging } = await import('../logger')

    initLogging()

    expect(consoleError, 'boot must not re-emit past errors').not.toHaveBeenCalled()
  })

  it('still keeps those stored errors for the in-app log viewer', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
    const { initLogging, logger } = await import('../logger')

    initLogging()

    // Silencing the console must not silence the LogViewer — that is where history belongs.
    expect(logger.getLogs({ level: ['error'] })).toHaveLength(2)
  })

  it('prints a new error exactly once', async () => {
    const { initLogging, error } = await import('../logger')
    initLogging()
    consoleError.mockClear()

    error('API Request Failed', { endpoint: '/categories', method: 'GET' }, 'ApiClient')

    // An error triggers a flush; if the flush also prints, every error is logged twice.
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(String(consoleError.mock.calls[0]![0])).toContain('API Request Failed')
  })

  it('keeps debug and info out of the console unless debug mode is on', async () => {
    const { initLogging, debug, info } = await import('../logger')
    initLogging()
    consoleInfo.mockClear()

    debug('noisy', undefined, 'X')
    info('also noisy', undefined, 'X')

    expect(consoleInfo).not.toHaveBeenCalled()
  })

  it('persists a new error alongside the existing history', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
    const { initLogging, error, logger } = await import('../logger')
    initLogging()

    error('API Request Failed', { endpoint: '/profiles', method: 'GET' }, 'ApiClient')

    const errors = logger.getLogs({ level: ['error'] })
    expect(errors).toHaveLength(3)
    // Newest first, so the LogViewer opens on what just happened.
    expect((errors[0]!.details as { endpoint: string }).endpoint).toBe('/profiles')
  })
})

/**
 * A user's console is not our log sink. In production the stored log — surfaced in
 * Settings > About — is the place to inspect problems; the console stays clean unless someone
 * deliberately turns debug mode on to chase something.
 */
describe('logger console gating by environment', () => {
  it('writes nothing to the console in production', async () => {
    vi.stubEnv('DEV', false)
    const { initLogging, error, warn } = await import('../logger')
    initLogging()

    error('API Request Failed', { endpoint: '/categories' }, 'ApiClient')
    warn('something odd', undefined, 'ApiClient')

    expect(consoleError, 'production must not print to the console').not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it('still records those entries for the in-app viewer in production', async () => {
    vi.stubEnv('DEV', false)
    const { initLogging, error, logger } = await import('../logger')
    initLogging()

    error('API Request Failed', { endpoint: '/categories' }, 'ApiClient')

    // Silence in the console, not silence in the log — this is the whole point of storing them.
    expect(logger.getLogs({ level: ['error'] })).toHaveLength(1)
  })

  it('lets debug mode opt back in, so a production problem can still be traced', async () => {
    vi.stubEnv('DEV', false)
    localStorage.setItem('debugMode', 'true')
    const { initLogging, error, info } = await import('../logger')
    initLogging()
    consoleError.mockClear()
    consoleInfo.mockClear()

    error('API Request Failed', { endpoint: '/categories' }, 'ApiClient')
    info('a detail', undefined, 'ApiClient')

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleInfo).toHaveBeenCalledTimes(1)
  })

  it('still surfaces errors in development', async () => {
    vi.stubEnv('DEV', true)
    const { initLogging, error } = await import('../logger')
    initLogging()
    consoleError.mockClear()

    error('API Request Failed', { endpoint: '/categories' }, 'ApiClient')

    expect(consoleError).toHaveBeenCalledTimes(1)
  })
})
