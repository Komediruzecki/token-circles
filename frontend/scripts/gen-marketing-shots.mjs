// ============================================================
// gen-marketing-shots — capture the product stills used by the landing sites.
//
// The published set lives outside this repo, in disjoint-colliders under
// packages/showcase-gallery/assets/token-circles, and is bundled into irchiinnuss.com
// and blog.irchiinnuss.com. They are product screenshots, so they go stale every time
// the UI moves. This is the repeatable way to re-shoot them.
//
// See docs/marketing-screenshots.md for the full walkthrough.
//
// Quick version, from `frontend/`. The app and its database are the e2e suite's: wrangler
// against a local D1, vite proxying /api at it, and the seeded fixture account. Playwright
// brings all three up and tears them down, so this is the whole setup:
//
//   E2E_PORT=3900 E2E_API_PORT=8790 npx playwright test --config=playwright.shots.config.ts
//   BASE_URL=http://127.0.0.1:3900 npm run marketing:shots
//
// The first command is what seeds the database and leaves it seeded; it also re-shoots the PWA
// install screenshots, which is harmless. It has to run FIRST and it has to have finished — a
// capture against an unseeded database photographs six empty states without complaint.
//
// (The set used to come from the Express server's three-profile demo, seeded by
// `backend/scripts/nuke-demo.js` and shot from profile 3. That runtime is gone; the fixture
// account is what the repository has now. It is thinner — one checking account, three tickers —
// so frames that leaned on the old profile's density read leaner.)
//
// Env vars:
//   BASE_URL   app URL                                   (default http://127.0.0.1:3900)
//   OUT        output directory                          (default frontend/local/marketing-shots)
//   SHOT       capture one slug or route only            (default: all six)
//   PROFILE    profile id to shoot                       (default: the fixture, looked up by name)
//   EMAIL      account to sign in as                     (default e2e@tokencircles.test)
//   PASSWORD   its password
//   LIGHT=1    light theme instead of the published dark one
//   CHROMIUM   chromium executable path
//
// Two things here are deliberate and easy to undo by accident, because both fail by
// producing a plausible-looking wrong image rather than an error:
//
//   - The theme is pinned in localStorage. The app follows prefers-color-scheme when
//     nothing is pinned and headless Chromium reports *light*, so an unpinned run
//     quietly returns a whole light set to sit in a dark published gallery.
//   - The scrollbar and animation suppression is an init script, not addStyleTag. A
//     style tag belongs to the document that was live when it ran, so it evaporates on
//     the first navigation and only the first shot comes out clean.
//
// Shot at 2x and halved rather than captured at 1x: a browser at deviceScaleFactor 2
// renders text on the full hinting grid, and an exact 2:1 downscale keeps that detail
// instead of asking the encoder to invent it. If the output size changes, keep the
// pairing — an awkward ratio resamples and the text goes soft.
// ============================================================
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3900'
// Defaults inside this repo, into a `local/` directory git already ignores. Publishing
// means pointing OUT at the gallery checkout, which is a deliberate act — a default that
// guessed at a sibling directory would either write somewhere surprising or silently
// create it.
const OUT = process.env.OUT || fileURLToPath(new URL('../local/marketing-shots', import.meta.url))
const ONLY = process.env.SHOT || ''
// Resolved after login when not pinned: the fixture profile's id depends on what else the
// database has seen, so hardcoding one is how a set comes back showing an empty profile.
let PROFILE = process.env.PROFILE || ''
const FIXTURE_PROFILE = 'E2E Fixture'
const EMAIL = process.env.EMAIL || 'e2e@tokencircles.test'
const PASSWORD = process.env.PASSWORD || 'something-like-this'
const DARK = process.env.LIGHT !== '1'

// The published masters are exactly this size, and showcase-gallery/src/index.ts declares
// it for every entry. The lightbox reserves that box before the image loads, so a master
// of a different shape shifts the layout on the live site.
const W = 1440
const H = 900

// `ready` is a hook that only exists once the page itself has mounted. `expect` is the
// separate question of whether it mounted with anything IN it: a header renders just as
// happily above an empty state, and an empty state photographs without complaint. Both
// come from hooks the e2e specs already gate on, so a rename fails here loudly rather
// than quietly changing what gets published.
const SHOTS = [
  {
    slug: '01-dashboard',
    route: 'dashboard',
    ready: 'dashboard-metrics',
    expect: { selector: '[data-test-id="dashboard-metrics"]', min: 1 },
  },
  {
    slug: '02-transactions',
    route: 'transactions',
    ready: 'transactions-header',
    expect: { selector: '[data-test-id="transactions-row"]', min: 5 },
  },
  {
    slug: '03-budgets',
    route: 'budgets',
    ready: 'budgets-header',
    expect: { selector: 'tbody tr', min: 3 },
  },
  {
    slug: '04-analytics',
    route: 'analytics',
    ready: 'analytics-trends-year',
    expect: { selector: 'svg, canvas', min: 2 },
  },
  {
    slug: '05-portfolio',
    route: 'portfolio',
    ready: 'portfolio-header',
    expect: { selector: 'tbody tr', min: 2 },
  },
  {
    slug: '06-import',
    route: 'import',
    ready: 'import-tab-google-sheets',
    expect: { selector: '[data-test-id^="import-tab-"]', min: 3 },
    // The only page here that is not a view of money. It offers routes IN — a sheet, a
    // file, a paste box, a bank — so it carries almost no figures at all, and the tab
    // count above is what actually proves it rendered.
    minDigits: 0,
  },
]

// A page can clear its `expect` count and still be a bad photograph — a table of rows
// that are all "—" renders fine. Most of these pages are dense with money, so the digits
// on screen are a cheap proxy for "this has real data in it". Every shot measured several
// times above this when the set was taken; the floor catches a collapse, it does not
// grade the frame. Override per shot with `minDigits` where the page is not about money.
const MIN_DIGITS = 40

const wanted = ONLY ? SHOTS.filter((s) => s.slug === ONLY || s.route === ONLY) : SHOTS
if (wanted.length === 0) {
  console.error(`FATAL: SHOT="${ONLY}" matches none of: ${SHOTS.map((s) => s.slug).join(', ')}`)
  process.exit(1)
}

// Preflight both external dependencies before opening a browser, so a missing one costs
// a line of output rather than six timeouts.
try {
  execFileSync('magick', ['-version'], { stdio: 'ignore' })
} catch {
  console.error('FATAL: ImageMagick `magick` is not on PATH. It does the 2:1 downscale to webp.')
  process.exit(1)
}

const reachable = await fetch(BASE, { method: 'HEAD' }).then(
  (r) => r.ok,
  () => false
)
if (!reachable) {
  console.error(
    `FATAL: nothing answering at ${BASE}.\n` +
      `  Bring it up (and seed it):  E2E_PORT=3900 E2E_API_PORT=8790 npx playwright test --config=playwright.shots.config.ts\n` +
      `  Or point BASE_URL at wherever it is already running.`
  )
  process.exit(1)
}

const launchOpts = {}
if (process.env.CHROMIUM) launchOpts.executablePath = process.env.CHROMIUM
let browser
try {
  browser = await chromium.launch(launchOpts)
} catch (err) {
  console.error(
    `FATAL: could not launch Chromium — ${String(err).split('\n')[0]}\n` +
      `  Install it with: npx playwright install chromium\n` +
      `  Or set CHROMIUM to an existing binary.`
  )
  process.exit(1)
}

const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  colorScheme: DARK ? 'dark' : 'light',
})

// Authenticate through the API the way the e2e helpers do, so the session cookie is in
// the context before the first paint and no shot catches a login screen.
const loginRes = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { email: EMAIL, password: PASSWORD },
})
if (!loginRes.ok()) {
  console.error(
    `FATAL: login returned ${loginRes.status()} for ${EMAIL}. The dev server is up, so this is ` +
      `the Worker behind it. Run the shots config first — it registers and seeds this ` +
      `account:\n` +
      `  E2E_PORT=3900 E2E_API_PORT=8790 npx playwright test --config=playwright.shots.config.ts`
  )
  await browser.close()
  process.exit(1)
}

// The fixture profile's id is whatever the database handed out. Reading it back beats guessing:
// a wrong id is not an error anywhere, it is six shots of somebody else's empty profile.
if (!PROFILE) {
  const profilesRes = await ctx.request.get(`${BASE}/api/profiles`)
  const body = profilesRes.ok() ? await profilesRes.json() : null
  const profiles = Array.isArray(body) ? body : (body?.profiles ?? [])
  const fixture = profiles.find((p) => p.name === FIXTURE_PROFILE) ?? profiles[0]
  if (!fixture) {
    console.error(
      `FATAL: ${EMAIL} owns no profiles. Run the shots config first to seed the fixture.`
    )
    await browser.close()
    process.exit(1)
  }
  PROFILE = String(fixture.id)
  if (fixture.name !== FIXTURE_PROFILE) {
    console.warn(`  no "${FIXTURE_PROFILE}" profile; shooting "${fixture.name}" instead`)
  }
}

await ctx.addInitScript(
  ({ dark, profile }) => {
    // Init scripts run on EVERY document, including the about:blank between shots, whose
    // opaque origin throws SecurityError on any storage access. Nothing to seed there.
    try {
      if (!window.localStorage) return
    } catch {
      return
    }
    localStorage.setItem('currentProfileId', profile)
    // The shell reads the selection, not just the current id. Without this the sidebar
    // and every page fall back to profile 1 while only the header follows PROFILE.
    localStorage.setItem('selectedProfileIds', JSON.stringify([Number(profile)]))
    // 'finance-theme' is the live key (src/core/theme.ts). Pinning it counts as an
    // explicit choice, which is what stops resolveTheme() falling through to the system
    // preference. The older 'darkMode' key does nothing.
    localStorage.setItem('finance-theme', dark ? 'dark' : 'light')
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    // A first-run overlay or an auto-launched tour would sit on top of every shot.
    localStorage.setItem('finance_onboarding', 'completed')
  },
  { dark: DARK, profile: PROFILE }
)

await ctx.addInitScript(() => {
  const install = () => {
    const style = document.createElement('style')
    style.textContent = `
      ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `
    document.head.appendChild(style)
  }
  if (document.head) install()
  else document.addEventListener('DOMContentLoaded', install, { once: true })
})

const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 140)))

const tmp = mkdtempSync(join(tmpdir(), 'tc-shots-'))
mkdirSync(OUT, { recursive: true })
const failures = []

console.log(`profile ${PROFILE}, ${DARK ? 'dark' : 'light'} theme, ${W}x${H} @2x -> ${OUT}\n`)

for (const shot of wanted) {
  process.stdout.write(`${shot.slug.padEnd(16)} `)
  try {
    // Blank first. Going straight from one hash to the next is a same-document
    // navigation, so the router swaps pages inside a DOM that still holds the last one —
    // the row assertions below then count the previous page's tables too (portfolio
    // "found" 77 rows following analytics, against its real 8), and a shot can catch the
    // handover. A real document load per shot makes each one independent of its order.
    await page.goto('about:blank')
    await page.goto(`${BASE}/#${shot.route}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector(`[data-test-id="${shot.ready}"]`, { timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.evaluate(() => document.fonts.ready)
    // Charts mount their series after the data resolves, a frame or two behind the
    // readiness hook.
    await page.waitForTimeout(1200)

    const found = await page.locator(shot.expect.selector).count()
    if (found < shot.expect.min) {
      throw new Error(
        `only ${found} of an expected ${shot.expect.min}+ "${shot.expect.selector}" — ` +
          `is profile ${PROFILE} seeded? ` +
          `(npx playwright test --config=playwright.shots.config.ts --project=setup)`
      )
    }
    const digits = await page.evaluate(() => (document.body.innerText.match(/\d/g) || []).length)
    const minDigits = shot.minDigits ?? MIN_DIGITS
    if (digits < minDigits) {
      throw new Error(`only ${digits} digits on screen — the page looks empty`)
    }

    const png = join(tmp, `${shot.slug}.png`)
    await page.screenshot({ path: png })
    const out = join(OUT, `${shot.slug}.webp`)
    execFileSync('magick', [png, '-resize', `${W}x${H}`, '-quality', '88', out])
    console.log(
      `${W}x${H}  ${String(statSync(out).size).padStart(7)}B  (${found} rows, ${digits} digits)`
    )
  } catch (err) {
    failures.push(`${shot.slug}: ${String(err.message || err).split('\n')[0]}`)
    console.log(`FAILED`)
  }
}

await browser.close()
rmSync(tmp, { recursive: true, force: true })

if (failures.length) {
  console.error(`\n${failures.length} of ${wanted.length} shot(s) failed:`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log(`\nWrote ${wanted.length} shot(s) to ${OUT}`)
