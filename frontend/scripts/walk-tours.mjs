// ============================================================
// walk-tours — step through EVERY guided spotlight tour in a real browser
// and assert each step's spotlight lands on a visible element.
//
// The static guardrails in src/core/__tests__/spotlightStore.test.ts prove a step's
// `data-tour` anchor exists *in the source*. They cannot prove it is RENDERED and
// VISIBLE at the moment the tour reaches it — an anchor behind a tab, a collapsed
// section, an empty state, or a page that never mounts still passes them. Only a
// real browser walk catches that, which is what this script does.
//
// Usage:
//   # Everything the e2e suite needs, which is everything this needs: the Worker on :8787
//   # against a local D1, the dev server proxying /api at it, and the seeded fixture account.
//   cd frontend && pnpm exec playwright test --project=setup
//   # ...then, with those servers still up:
//   pnpm run test:tours
//
// The setup project boots both servers, seeds the fixture profile and writes the signed-in
// session to tests/.auth/state.json, which this script loads. It does NOT sign in itself: the
// login route is rate-limited, and one shared session is the whole reason global.setup exists.
//
// Env vars:
//   BASE_URL   app URL (default http://127.0.0.1:3800)
//   MOBILE=1   390x844 touch viewport instead of 1280x800
//   TOUR       walk only the tour with this id (default: all)
//   CHROMIUM   chromium executable path (falls back to /opt/pw-browsers/chromium)
//
// Exits 0 when every step of every tour spotlights a visible element; exits 1 and
// prints MISS lines otherwise.
// ============================================================
import { existsSync, readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || `http://127.0.0.1:${process.env.E2E_PORT || 3800}`
// Written by tests/global.setup.ts; the same path tests/e2e-constants.ts names.
const STATE_PATH = 'tests/.auth/state.json'
const MOBILE = process.env.MOBILE === '1'
const ONLY = process.env.TOUR || ''

// A spotlight rect smaller than this is a mis-anchored step (a collapsed or zero-size
// element), not a real highlight.
const MIN_HIGHLIGHT_PX = 14

// Tour ids + labels come straight from the store, so a newly added tour is walked
// without touching this script. The label is what the selection modal renders.
const storeSrc = readFileSync(new URL('../src/core/spotlightStore.ts', import.meta.url), 'utf8')
const TOURS = [...storeSrc.matchAll(/id:\s*'([a-z0-9-]+)',\s*\n\s*label:\s*'([^']+)',/g)].map(
  (m) => ({ id: m[1], label: m[2] })
)
if (TOURS.length === 0) {
  console.error('FATAL: parsed 0 tours out of spotlightStore.ts — has the shape changed?')
  process.exit(1)
}

const launchOpts = {}
if (process.env.CHROMIUM) launchOpts.executablePath = process.env.CHROMIUM
let browser
try {
  browser = await chromium.launch(launchOpts)
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
}

/*
 * The signed-in session, exactly as the e2e suite uses it.
 *
 * This script used to sign in for itself, against the Express backend on :3847 with a
 * username and password. That backend is gone — the API is the Worker now, its login takes an
 * email, and the fixture account lives in a local D1 that has to be seeded first. Rather than
 * grow a second copy of all that, the walk reuses what `global.setup.ts` already produced.
 */
if (!existsSync(STATE_PATH)) {
  console.error(
    `FATAL: no saved session at ${STATE_PATH}.\n` +
      `Run the setup project first — it boots the Worker and the dev server, seeds the fixture ` +
      `profile and writes the session:\n\n  pnpm exec playwright test --project=setup\n`
  )
  process.exit(1)
}

const ctx = await browser.newContext({
  viewport: MOBILE ? { width: 390, height: 844 } : { width: 1280, height: 800 },
  hasTouch: MOBILE,
  storageState: STATE_PATH,
})

await ctx.addInitScript(() => {
  // Start every tour from a clean slate so "Done" badges never change the modal layout.
  localStorage.removeItem('finance_spotlight_tours')
})

const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 140)))

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('[data-test-id="whats-new-btn"]', { timeout: 30000 })
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

const tooltip = page.locator('[class*="tooltip"]')

async function openTourModal() {
  // The "What's New" button collapses the sidebar on click, so it needs re-opening for
  // every tour. On mobile the sidebar is a drawer: its nav stays in the DOM but sits
  // off-screen, so Playwright reports the button as visible while the click lands outside
  // the viewport and times out. Open the drawer explicitly there rather than trusting
  // visibility.
  const btn = page.locator('[data-test-id="whats-new-btn"]')
  const toggle = page.locator('[aria-label="Toggle sidebar"]').first()

  /*
   * Is the drawer open? Horizontally only.
   *
   * A closed drawer parks the whole nav at a negative x (-240), so x is what actually says
   * open or shut. Vertical position says nothing: the nav scrolls, and "What's New" is near
   * the bottom of it — on a phone it sits at y ≈ 1182 in an 844-tall viewport, open or not.
   * An earlier version required the button to be inside the viewport vertically too, which no
   * amount of toggling could ever make true; it walked four tours and then hung on the fifth,
   * where the nav happened to be scrolled, blaming the fifth tour for it. `scrollIntoViewIfNeeded`
   * below is what handles the vertical half, and it needs the drawer open first.
   */
  const drawerOpen = async () => {
    const box = await btn.boundingBox().catch(() => null)
    if (!box) return false
    return box.x >= 0 && box.x < page.viewportSize().width
  }
  /*
   * Poll for the drawer instead of clicking once and sleeping.
   *
   * A single click with a fixed 400ms wait fails whenever the drawer is mid-animation or the
   * click lands while the page is still settling after the previous tour — and because the
   * click's error was swallowed, the failure surfaced 8 seconds later as an unactionable button,
   * naming the wrong element. It walked four tours on a phone and then died on the fifth, every
   * time, with nothing wrong with the fifth.
   *
   * Each attempt clicks and then waits for the button to actually reach the viewport, which is
   * the condition that matters. Clicking a toggle twice is harmless: if the first one did open
   * the drawer, the loop exits before the second.
   */
  for (let attempt = 0; attempt < 4 && !(await drawerOpen()); attempt++) {
    await toggle.click({ timeout: 5000 }).catch(() => {})
    for (let waited = 0; waited < 1500 && !(await drawerOpen()); waited += 100) {
      await page.waitForTimeout(100)
    }
  }
  if (!(await drawerOpen())) {
    throw new Error(
      'the sidebar drawer never opened after 4 attempts at the toggle. Every tour is started ' +
        'from it, so nothing can be walked.'
    )
  }
  await btn.scrollIntoViewIfNeeded().catch(() => {})
  await btn.click({ timeout: 8000 })
  await page.waitForSelector('[class*="tourCard"]', { timeout: 8000 })
}

let totalSteps = 0
let missing = 0
const failures = []

async function walkTour({ id, label }) {
  await openTourModal()
  const card = page
    .locator('[class*="tourCard"]')
    .filter({ has: page.locator(`[class*="tourLabel"]:text-is("${label}")`) })
    .first()
  if (!(await card.isVisible().catch(() => false))) {
    console.log(`\n### ${label} (${id}): NOT LISTED IN THE TOUR MODAL`)
    missing++
    failures.push(`${label}: tour not listed in the selection modal`)
    return
  }
  await card.click()

  try {
    await tooltip.waitFor({ state: 'visible', timeout: 8000 })
  } catch {
    console.log(`\n### ${label} (${id}): TOUR DID NOT START`)
    missing++
    failures.push(`${label}: tour did not start`)
    return
  }

  console.log(`\n### ${label} (${id})`)
  const seen = new Set()
  for (let i = 0; i < 40; i++) {
    // Let the step settle: App.tsx navigates to requiredPage, the page chunk loads
    // lazily, and Spotlight waits up to ~6s for its target via MutationObserver.
    await page.waitForTimeout(1200)
    if (!(await tooltip.isVisible().catch(() => false))) break

    const title = (
      (await page
        .locator('[class*="tooltip"] h3')
        .first()
        .textContent()
        .catch(() => '')) ?? ''
    ).trim()
    const key = `${i}:${title}`
    if (seen.has(key)) break
    seen.add(key)

    // Two independent signals: the app's own "target missing" banner, and the size of
    // the SVG glow rect it draws around the resolved target.
    const flagged = await page
      .locator('[class*="targetMissing"]')
      .isVisible()
      .catch(() => false)
    const box = await page
      .locator('svg[class*="backdropSvg"] rect[stroke-width="2"]')
      .first()
      .boundingBox()
      .catch(() => null)
    const sized = !!box && box.width > MIN_HIGHLIGHT_PX && box.height > MIN_HIGHLIGHT_PX
    const ok = !flagged && sized

    totalSteps++
    if (!ok) {
      missing++
      failures.push(
        `${label} / step ${i + 1} "${title}": ${flagged ? 'app reports target missing' : 'no visible highlight'}`
      )
    }
    console.log(
      `  ${ok ? 'ok  ' : 'MISS'}  step ${i + 1}: ${title}  ` +
        `${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no-highlight'}` +
        `${flagged ? ' [target-missing banner]' : ''}`
    )

    const next = page.locator('[class*="tooltip"] [class*="btnPrimary"]').last()
    if (!(await next.isVisible().catch(() => false))) break
    await next.click().catch(() => {})
  }

  // Leave no tour running into the next one.
  if (await tooltip.isVisible().catch(() => false)) {
    await page
      .locator('[class*="tooltip"] button', { hasText: 'End Tour' })
      .first()
      .click()
      .catch(() => {})
    await page.waitForTimeout(300)
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
}

for (const t of TOURS) {
  if (ONLY && t.id !== ONLY) continue
  await walkTour(t)
}

console.log(`\nTOTAL steps: ${totalSteps}, steps without a visible spotlight: ${missing}`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
}
await browser.close()
process.exit(missing === 0 ? 0 : 1)
