/**
 * appVersion — deploy-detection decision logic.
 *
 * Covers the pure assessment core (server sha vs running build), the reload guards (one
 * auto-reload per sha + rolling cap across shas, so back-to-back releases each get exactly
 * one reload and a flapping pipeline can't spin a tab), and the signal reconciliation done
 * by checkForUpdate (label correction on a mis-stamped build, update announcement, rollback
 * stand-down). The build identity under test is pinned by vitest.config define:
 * __APP_VERSION__ = '0.0.0-test', __GIT_SHA__ = 'testsha'.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  toast: vi.fn(),
}))

const BUILD = { version: '0.0.0-test', sha: 'testsha' }

async function freshModule() {
  vi.resetModules()
  return await import('../appVersion')
}

function stubVersionJson(payload: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      json: async () => payload,
    }))
  )
}

beforeEach(() => {
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('assessVersion', () => {
  it('reports no-info when version.json is missing or has no sha', async () => {
    const { assessVersion } = await freshModule()
    expect(assessVersion(BUILD, null)).toEqual({ kind: 'no-info' })
    expect(assessVersion(BUILD, { version: '5.6.1' })).toEqual({ kind: 'no-info' })
  })

  it('reports no-info for a local/dev build (no usable own sha) — never nags', async () => {
    const { assessVersion } = await freshModule()
    const info = { version: '5.6.1', gitSha: 'aaa1111' }
    expect(assessVersion({ version: '5.6.1', sha: '' }, info)).toEqual({ kind: 'no-info' })
    expect(assessVersion({ version: '5.6.1', sha: 'unknown' }, info)).toEqual({
      kind: 'no-info',
    })
  })

  it('is current with no correction when sha and version both match', async () => {
    const { assessVersion } = await freshModule()
    const verdict = assessVersion(BUILD, { version: BUILD.version, gitSha: BUILD.sha })
    expect(verdict).toEqual({ kind: 'current', correctedLabel: null })
  })

  it('corrects the label when the server runs OUR commit under a different version string', async () => {
    // The observed prod skew: a build whose compiled stamp lied (non-tag build) — the
    // executing code IS what the server serves, so the network version string wins.
    const { assessVersion } = await freshModule()
    const verdict = assessVersion(BUILD, { version: '5.6.1', gitSha: BUILD.sha })
    expect(verdict).toEqual({ kind: 'current', correctedLabel: '5.6.1' })
  })

  it('does not invent a correction when the server omits the version string', async () => {
    const { assessVersion } = await freshModule()
    const verdict = assessVersion(BUILD, { gitSha: BUILD.sha })
    expect(verdict).toEqual({ kind: 'current', correctedLabel: null })
  })

  it('reports an update when the server runs a different commit', async () => {
    const { assessVersion } = await freshModule()
    expect(assessVersion(BUILD, { version: '5.6.1', gitSha: 'bbb2222' })).toEqual({
      kind: 'update',
      serverSha: 'bbb2222',
      serverVersion: '5.6.1',
    })
    expect(assessVersion(BUILD, { gitSha: 'bbb2222' })).toEqual({
      kind: 'update',
      serverSha: 'bbb2222',
      serverVersion: null,
    })
  })
})

describe('auto-reload guards', () => {
  const T0 = 1_000_000

  it('allows one reload per sha and blocks repeats for the same sha', async () => {
    const { shouldAutoReload, recordAutoReload } = await freshModule()
    expect(shouldAutoReload('sha-a', T0)).toBe(true)
    recordAutoReload('sha-a', T0)
    expect(shouldAutoReload('sha-a', T0 + 1000)).toBe(false)
  })

  it('allows a later back-to-back release (new sha) its own reload', async () => {
    const { shouldAutoReload, recordAutoReload } = await freshModule()
    recordAutoReload('sha-a', T0)
    expect(shouldAutoReload('sha-b', T0 + 60_000)).toBe(true)
  })

  it('caps total reloads in the rolling window even across different shas', async () => {
    const { shouldAutoReload, recordAutoReload } = await freshModule()
    recordAutoReload('sha-a', T0)
    recordAutoReload('sha-b', T0 + 1000)
    recordAutoReload('sha-c', T0 + 2000)
    expect(shouldAutoReload('sha-d', T0 + 3000)).toBe(false)
  })

  it('re-allows reloads once the window has passed', async () => {
    const { shouldAutoReload, recordAutoReload } = await freshModule()
    recordAutoReload('sha-a', T0)
    recordAutoReload('sha-b', T0 + 1000)
    recordAutoReload('sha-c', T0 + 2000)
    const later = T0 + 11 * 60 * 1000 // beyond the 10-minute window
    expect(shouldAutoReload('sha-d', later)).toBe(true)
  })

  it('treats corrupted reload history as empty instead of throwing', async () => {
    const { shouldAutoReload } = await freshModule()
    sessionStorage.setItem('tc-version-reload-times', 'not json')
    expect(shouldAutoReload('sha-a', T0)).toBe(true)
  })
})

describe('checkForUpdate signal reconciliation', () => {
  it('adopts the network version string when the server runs our commit (mis-stamped build)', async () => {
    const mod = await freshModule()
    stubVersionJson({ version: '5.6.1', gitSha: 'testsha' })
    expect(mod.displayVersion()).toBe('0.0.0-test')
    await mod.checkForUpdate()
    expect(mod.displayVersion()).toBe('5.6.1')
    expect(mod.updateAvailable()).toBe(false)
    expect(mod.serverVersion()).toBeNull()
  })

  it('keeps the executing version as the label when the server runs a NEWER commit', async () => {
    // The tab still executes the old bundle — claiming the new version would lie.
    const mod = await freshModule()
    stubVersionJson({ version: '9.9.9', gitSha: 'newsha' })
    await mod.checkForUpdate()
    expect(mod.displayVersion()).toBe('0.0.0-test')
    expect(mod.updateAvailable()).toBe(true)
    expect(mod.serverVersion()).toBe('9.9.9')
  })

  it('announces an update with a toast exactly once across repeated polls', async () => {
    const mod = await freshModule()
    const { toast } = await import('../api')
    stubVersionJson({ version: '9.9.9', gitSha: 'newsha' })
    await mod.checkForUpdate()
    await mod.checkForUpdate()
    expect(vi.mocked(toast)).toHaveBeenCalledTimes(1)
  })

  it('stands down after a rollback to the running commit', async () => {
    const mod = await freshModule()
    stubVersionJson({ version: '9.9.9', gitSha: 'newsha' })
    await mod.checkForUpdate()
    expect(mod.updateAvailable()).toBe(true)
    stubVersionJson({ version: '0.0.0-test', gitSha: 'testsha' })
    await mod.checkForUpdate()
    expect(mod.updateAvailable()).toBe(false)
    expect(mod.serverVersion()).toBeNull()
  })

  it('changes nothing when version.json is unreachable or non-OK', async () => {
    const mod = await freshModule()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    await mod.checkForUpdate()
    expect(mod.updateAvailable()).toBe(false)
    expect(mod.displayVersion()).toBe('0.0.0-test')

    stubVersionJson({ version: '9.9.9', gitSha: 'newsha' }, false)
    await mod.checkForUpdate()
    expect(mod.updateAvailable()).toBe(false)
  })
})
