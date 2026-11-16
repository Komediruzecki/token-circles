/**
 * The first paint is the theme the screen settles on.
 *
 * `public/theme-init.js` stamps `data-theme` before anything paints, and App applies
 * `core/screenTheme.ts`'s `themeFor` once it knows who is signed in. When the two disagreed the
 * screen changed theme under the visitor: with the system on light and no stored choice, the
 * sign-in screen painted light and turned dark about 100 ms later, and a signed-in boot went light,
 * dark, light (3 Nov review). This runs theme-init.js for every combination of stored choice,
 * system theme, storage mode, recorded screen and reset link, and requires the answer `themeFor`
 * gives for the screen that boot shows. tests/theme-first-paint.spec.ts watches the real boots.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the one path is resolved from
   __dirname. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyScreenTheme, SCREEN_KEY, THEME_KEY, themeFor } from '../core/screenTheme'
import type { Screen } from '../core/screenTheme'

const INIT = readFileSync(resolve(__dirname, '../../public/theme-init.js'), 'utf8')

function system(light: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (q: string) => ({ matches: q.includes('light') ? light : !light }) as MediaQueryList
  )
}

function setOrClear(key: string, v: string | null) {
  if (v === null) localStorage.removeItem(key)
  else localStorage.setItem(key, v)
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  window.location.hash = ''
})

describe('theme-init.js stamps what the screen settles on', () => {
  for (const stored of [null, 'light', 'dark', 'sepia'])
    for (const systemLight of [true, false])
      for (const mode of [null, 'self-hosted', 'serverless'])
        for (const recorded of [null, 'app', 'signed-out'])
          for (const profile of [null, '1'])
            for (const reset of [false, true]) {
              // The screen this boot shows, for a visitor whose session is as it was last time:
              // the reset link shows its own page, local-first shows the app, and otherwise
              // App's last answer holds. With no answer yet (the first visit since the record
              // began), a current profile means signed in.
              const signedIn = recorded === 'app' || (recorded === null && profile !== null)
              const screen: Screen =
                !reset && (mode === 'serverless' || signedIn) ? 'app' : 'signed-out'
              const name = `stored ${stored}, system ${systemLight ? 'light' : 'dark'}, mode ${mode}, last screen ${recorded}, profile ${profile}${reset ? ', reset link' : ''}`
              it(name, () => {
                setOrClear(THEME_KEY, stored)
                setOrClear('finance_storage_mode', mode)
                setOrClear(SCREEN_KEY, recorded)
                setOrClear('currentProfileId', profile)
                system(systemLight)
                if (reset) window.location.hash = 'reset-password?token=example'
                // eslint-disable-next-line @typescript-eslint/no-implied-eval, sonarjs/code-eval -- the shipped pre-paint script, run as the browser runs it
                new Function(INIT)()
                expect(document.documentElement.getAttribute('data-theme')).toBe(
                  themeFor(stored, screen, systemLight)
                )
              })
            }
})

describe('themeFor', () => {
  it('keeps signed-out screens dark unless a theme was chosen', () => {
    expect(themeFor(null, 'signed-out', true)).toBe('dark')
    expect(themeFor('light', 'signed-out', false)).toBe('light')
  })

  it('lets the app follow the system unless a theme was chosen', () => {
    expect(themeFor(null, 'app', true)).toBe('light')
    expect(themeFor(null, 'app', false)).toBe('dark')
    expect(themeFor('dark', 'app', true)).toBe('dark')
  })
})

describe('applyScreenTheme', () => {
  it('records the screen for the next boot and stamps its theme', () => {
    system(true)
    applyScreenTheme('app')
    expect(localStorage.getItem(SCREEN_KEY)).toBe('app')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyScreenTheme('signed-out')
    expect(localStorage.getItem(SCREEN_KEY)).toBe('signed-out')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('does not touch a theme that already fits', () => {
    system(true)
    document.documentElement.setAttribute('data-theme', 'light')
    const seen: string[] = []
    const watcher = new MutationObserver((records) => {
      for (const r of records) seen.push(String(r.attributeName))
    })
    watcher.observe(document.documentElement, { attributes: true })
    applyScreenTheme('app')
    const pending = watcher.takeRecords()
    watcher.disconnect()
    expect([...seen, ...pending.map((r) => String(r.attributeName))]).toEqual([])
  })
})
