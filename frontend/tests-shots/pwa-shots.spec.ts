/* eslint-disable security/detect-non-literal-fs-filename -- OUT is a fixed path under public/ */
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { E2E_BASE } from '../tests/e2e-constants'

/**
 * The manifest `screenshots` — what Chrome shows in the rich install dialog on Android, and what
 * a listing surface shows beside the name. Without them the dialog is a name, an icon and a URL.
 *
 * Run with `npm run pwa:shots` (playwright.shots.config.ts), never as part of the suite: these
 * write into `public/` and are not assertions.
 *
 * Sizes are fixed by the manifest and by Chrome's own rules: every dimension between 320 and
 * 3840, the long side no more than 2.3x the short side, and one consistent aspect ratio per
 * form factor. 1280x720 and 720x1280 satisfy all of it, and the manifest declares exactly these
 * numbers — a declared size that does not match the file is the one way this silently stops
 * working, so `manifestAssets.test.ts` reads the PNG headers back and compares.
 */
const OUT = new URL('../public/screenshots/', import.meta.url).pathname

const WIDE = { width: 1280, height: 720 }
const NARROW = { width: 720, height: 1280 }

/** Route, file stem, and the element whose presence means the page has actually resolved. */
const SHOTS = [
  { route: 'dashboard', slug: 'dashboard', ready: 'dashboard-metrics' },
  { route: 'transactions', slug: 'transactions', ready: 'transactions-header' },
  { route: 'analytics', slug: 'analytics', ready: 'analytics-header' },
] as const

test.beforeAll(() => {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
})

for (const { route, slug, ready } of SHOTS) {
  for (const [form, viewport] of [
    ['wide', WIDE],
    ['narrow', NARROW],
  ] as const) {
    test(`${form} ${slug}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      // Dark, pinned, before the app boots. `finance-theme` is the key public/theme-init.js
      // reads (the e2e fixture state's `darkMode` is a dead key nothing has read since the
      // theme moved to core/theme.ts); with nothing pinned the app follows
      // prefers-color-scheme, and headless Chromium reports light — which is how an unpinned
      // run returns a light set to sit beside a #0a0e1c splash screen. The project also
      // requests colorScheme 'dark' so the media query agrees rather than merely being overruled.
      //
      // An init script and not addStyleTag: a style tag belongs to the document that was live
      // when it ran, so it evaporates on the first navigation and only the first shot is clean.
      await page.addInitScript(() => {
        try {
          localStorage.setItem('finance-theme', 'dark')
        } catch {
          /* about:blank has no accessible storage; the real document does */
        }
        const css = document.createElement('style')
        css.textContent =
          '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;' +
          'transition-duration:0s!important;transition-delay:0s!important}' +
          '::-webkit-scrollbar{width:0!important;height:0!important}'
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css))

        // Charts animate their first draw on rAF, which the CSS suppression above does not
        // reach. Rather than sleeping a guessed 1200ms, record when a frame callback last ran
        // so the shot can wait on the page having actually gone quiet. Faster when the charts
        // settle early, and correct when they take longer than a guess would have allowed.
        let lastFrameAt = window.performance.now()
        const raf = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = (cb) =>
          raf((t) => {
            lastFrameAt = window.performance.now()
            cb(t)
          })
        ;(window as unknown as { __msSinceLastFrame: () => number }).__msSinceLastFrame = () =>
          window.performance.now() - lastFrameAt
      })

      await page.goto(`${E2E_BASE}/#${route}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      // No frame callback for 400ms means every chart has finished drawing. Tolerated rather
      // than awaited: a view that animates forever would never satisfy this, and a slightly
      // early screenshot beats failing the whole shot run.
      await page
        .waitForFunction(
          () =>
            (window as unknown as { __msSinceLastFrame: () => number }).__msSinceLastFrame() > 400,
          null,
          { timeout: 15000 }
        )
        .catch(() => {})

      await page.screenshot({ path: `${OUT}${form}-${slug}.png`, scale: 'css' })
    })
  }
}
