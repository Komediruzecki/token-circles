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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('userIsMidEntry', () => {
  afterEach(() => {
    // In afterEach, not inline: a failing assertion must not leave a focused input or a
    // dialog node behind to pollute every later test in this file.
    document.body.innerHTML = ''
  })

  it('is false on a plain page', async () => {
    const { userIsMidEntry } = await freshModule()
    expect(userIsMidEntry()).toBe(false)
  })

  it('is true while a text-entry control holds focus', async () => {
    const { userIsMidEntry } = await freshModule()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(userIsMidEntry()).toBe(true)
  })

  it('ignores focus resting on a checkbox — that is not an entry in progress', async () => {
    const { userIsMidEntry } = await freshModule()
    const input = document.createElement('input')
    input.type = 'checkbox'
    document.body.appendChild(input)
    input.focus()
    expect(userIsMidEntry()).toBe(false)
  })

  it('is true for the other entry controls the shared predicate covers', async () => {
    // The focus half of this check lives in core/domFocus (exercised in full there); these
    // pin that userIsMidEntry still delegates to it rather than growing its own copy back.
    const { userIsMidEntry } = await freshModule()
    const select = document.createElement('select')
    document.body.appendChild(select)
    select.focus()
    expect(userIsMidEntry()).toBe(true)

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.appendChild(editable)
    editable.focus()
    expect(userIsMidEntry()).toBe(true)
  })

  it('is true while a modal dialog is open', async () => {
    const { userIsMidEntry } = await freshModule()
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    document.body.appendChild(modal)
    expect(userIsMidEntry()).toBe(true)
  })

  it('counts an alertdialog (destructive confirms) as open too', async () => {
    const { userIsMidEntry } = await freshModule()
    const confirm = document.createElement('div')
    confirm.setAttribute('role', 'alertdialog')
    document.body.appendChild(confirm)
    expect(userIsMidEntry()).toBe(true)
  })

  it('ignores a permanently-mounted dialog hidden behind pointer-events: none', async () => {
    // CommandBar and GuidedOrbit keep their role="dialog" nodes in the DOM at all times and
    // hide them with pointer-events: none — presence alone must NOT read as mid-entry, or the
    // auto-reload would be vetoed on every page forever (found in review).
    const { userIsMidEntry } = await freshModule()
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    overlay.style.pointerEvents = 'none'
    document.body.appendChild(overlay)
    expect(userIsMidEntry()).toBe(false)
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

  it('announces once while the notice is on screen, re-announces after it expires', async () => {
    const mod = await freshModule()
    // Post-freshModule so both resolve to the same registry instance as the module under test.
    const { toast } = await import('../api')
    const store = await import('../toastStore')
    stubVersionJson({ version: '9.9.9', gitSha: 'newsha' })

    await mod.checkForUpdate()
    // The api mock swallows the real addToast, so plant the live notice the announce would
    // have created; while it is on screen a second poll must not restart it.
    store.addToast('a new version is ready', 'info', { channel: 'app-update' })
    await mod.checkForUpdate()
    expect(vi.mocked(toast)).toHaveBeenCalledTimes(1)

    // Simulate the 60-second expiry: the next poll must raise the notice again, so a user
    // who missed one toast is never stranded without an affordance.
    store.removeToastsByChannel('app-update')
    await mod.checkForUpdate()
    expect(vi.mocked(toast)).toHaveBeenCalledTimes(2)
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
