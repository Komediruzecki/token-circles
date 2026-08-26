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
// The walk owns the API, because a dead API looks exactly like a broken tour. Pages render their
// empty states, spotlights have nothing to point at, and every remaining tour MISSes — a report
// that reads as fifteen UI regressions and is really one dead `wrangler dev`. Not hypothetical:
// `wrangler dev` has an upstream crash that kills it one to two minutes into a run, which a
// 15-tour walk always outlives, and which no wrangler version available to this repo avoids.
// See scripts/lib/worker-supervisor.mjs.
//
// So this script starts wrangler itself, watches it, restarts it when it dies, and re-walks the
// interrupted tour from the start against a fresh one. Worker trouble prints on `[worker]` lines
// and is counted separately from MISSes; a crash can never be reported as a tour failure.
//
// Usage:
//   # The app, and the seeded fixture account. Do NOT start wrangler yourself — this script does.
//   cd frontend && API_PROXY_TARGET=http://127.0.0.1:8787 npm run dev -- --port 3800 --strictPort
//   # ...then, in another terminal, seed the database and save the signed-in session:
//   cd frontend && pnpm exec playwright test --project=setup
//   # ...then walk:
//   pnpm run test:tours
//
// The setup project applies the migrations, seeds the fixture profile and writes the signed-in
// session to tests/.auth/state.json, which this script loads. It does NOT sign in itself: the
// login route is rate-limited, and one shared session is the whole reason global.setup exists.
// (A wrangler left running from that step, or from a terminal of your own, is adopted rather than
// killed — and replaced with a managed one the first time it dies.)
//
// Env vars:
//   BASE_URL              app URL (default http://127.0.0.1:3800)
//   E2E_API_PORT          port to run the Worker on (default 8787) — must match the dev proxy
//   MOBILE=1              390x844 touch viewport instead of 1280x800
//   TOUR                  walk only the tour with this id (default: all)
//   CHROMIUM              chromium executable path (falls back to /opt/pw-browsers/chromium)
//   WORKER_MAX_UPTIME_MS  recycle the Worker between tours once it is this old (default 60000);
//                         0 leaves only crash recovery
//
// Exit codes:
//   0  every step of every tour spotlighted a visible element
//   1  at least one step MISSed — a real tour regression, listed under "Failures"
//   2  the Worker could not be kept alive long enough to prove the tours either way
// ============================================================
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { WorkerDownError, WorkerSupervisor } from './lib/worker-supervisor.mjs'

const BASE = process.env.BASE_URL || `http://127.0.0.1:${process.env.E2E_PORT || 3800}`
const API_PORT = Number(process.env.E2E_API_PORT || 8787)
// Written by tests/global.setup.ts; the same path tests/e2e-constants.ts names.
const STATE_PATH = 'tests/.auth/state.json'
const MOBILE = process.env.MOBILE === '1'
const ONLY = process.env.TOUR || ''
const WORKER_MAX_UPTIME_MS = Number(process.env.WORKER_MAX_UPTIME_MS ?? 60000)

// A spotlight rect smaller than this is a mis-anchored step (a collapsed or zero-size
// element), not a real highlight.
const MIN_HIGHLIGHT_PX = 14

// How many times one tour may be re-walked after the Worker died under it. Three is enough for
// two crashes back to back; a tour that cannot survive three fresh workers is reported as
// unproven rather than as broken, which is the honest answer.
const MAX_TOUR_ATTEMPTS = 3

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
      `Run the setup project first — it applies the migrations, seeds the fixture profile and ` +
      `writes the session:\n\n  pnpm exec playwright test --project=setup\n`
  )
  process.exit(1)
}

/*
 * The Worker, before the browser: a walk against a dead API proves nothing, and finding that out
 * after launching chromium just means cleaning up more.
 *
 * The database and the JWT secret both outlive a restart — D1 is a directory under
 * worker/.wrangler and JWT_SECRET comes from worker/.dev.vars — so the seeded fixture and the
 * saved session survive every one of them. Migrations are the setup project's job; a state.json
 * on disk means they have already run.
 */
const worker = new WorkerSupervisor({
  port: API_PORT,
  workerDir: fileURLToPath(new URL('../../worker/', import.meta.url)),
  maxUptimeMs: WORKER_MAX_UPTIME_MS,
})
try {
  await worker.start()
} catch (err) {
  console.error(`\nFATAL: could not bring the Worker up on :${API_PORT}.\n${err.message}`)
  process.exit(2)
}

const launchOpts = {}
if (process.env.CHROMIUM) launchOpts.executablePath = process.env.CHROMIUM
let browser
try {
  browser = await chromium.launch(launchOpts)
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
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

const tooltip = page.locator('[class*="tooltip"]')

/**
 * Load the app fresh.
 *
 * Called at startup and after every Worker restart. A page that watched its API disappear is
 * holding empty stores and failed requests; nothing short of a reload gets it back to the state a
 * tour expects, and the init script above re-clears the "Done" badges on the way in.
 */
async function resetPage() {
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('[data-test-id="whats-new-btn"]', { timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  } catch (err) {
    // A shell that will not render is usually a shell with no API behind it. Same rule as
    // everywhere else here: ask the Worker before blaming the app.
    await worker.assertUpNow('reloading the app')
    throw err
  }
}

await resetPage()

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
    // Bounded: without a timeout this waits 30s for an element that is not attached, and the
    // retry loop below turns a dead page (an API that stopped answering, a shell that never
    // rendered) into half an hour of apparent hang before anything is reported.
    const box = await btn.boundingBox({ timeout: 1000 }).catch(() => null)
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
    worker.assertUp('opening the sidebar drawer')
    await toggle.click({ timeout: 5000 }).catch(() => {})
    for (let waited = 0; waited < 1500 && !(await drawerOpen()); waited += 100) {
      await page.waitForTimeout(100)
    }
  }
  if (!(await drawerOpen())) {
    // A dead API is the likeliest reason the shell never rendered, and it is not a drawer
    // problem. Ask before accusing: this throws WorkerDownError instead, and the tour is re-walked.
    await worker.assertUpNow('opening the sidebar drawer')
    // Say what the page actually was before dying — a hang here has twice turned out to be a
    // dead page (no shell at all), not a drawer problem, and the error alone cannot tell the
    // two apart.
    const url = page.url()
    const btnAttached = (await btn.count().catch(() => 0)) > 0
    const shot = 'test-results/walk-tours-drawer-fail.png'
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {})
    throw new Error(
      `the sidebar drawer never opened after 4 attempts at the toggle. Every tour is started ` +
        `from it, so nothing can be walked. url=${url} whats-new-btn attached=${btnAttached} ` +
        `screenshot=${shot}`
    )
  }
  await btn.scrollIntoViewIfNeeded().catch(() => {})
  await btn.click({ timeout: 8000 })
  await page.waitForSelector('[class*="tourCard"]', { timeout: 8000 })
}

let totalSteps = 0
let missing = 0
const failures = []
/** Tours the Worker never stayed up long enough to prove either way. Not the same as a failure. */
const unproven = []
let workerRetries = 0

async function walkTour({ id, label }) {
  await openTourModal()
  const card = page
    .locator('[class*="tourCard"]')
    .filter({ has: page.locator(`[class*="tourLabel"]:text-is("${label}")`) })
    .first()
  if (!(await card.isVisible().catch(() => false))) {
    await worker.assertUpNow(`listing "${label}" in the tour modal`)
    console.log(`\n### ${label} (${id}): NOT LISTED IN THE TOUR MODAL`)
    missing++
    failures.push(`${label}: tour not listed in the selection modal`)
    return
  }
  await card.click()

  try {
    await tooltip.waitFor({ state: 'visible', timeout: 8000 })
  } catch {
    await worker.assertUpNow(`starting "${label}"`)
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
    // Free — the watchdog has already noticed. Bail before grinding 40 steps through a dead app.
    worker.assertUp(`"${label}" step ${i + 1}`)
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

    // Before recording a MISS, prove the API was alive for it. A page whose data never arrived
    // renders empty states, and an empty state has nothing to spotlight — which is a true
    // observation about a dead Worker and a false one about the tour.
    if (!ok) await worker.assertUpNow(`"${label}" step ${i + 1} "${title}"`)

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

  // A death between the last step and here would otherwise close the tour out as passed.
  worker.assertUp(`finishing "${label}"`)

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

/**
 * Walk one tour, surviving as many Worker deaths as it takes.
 *
 * A crash is not a result, so an interrupted attempt is rolled back wholesale — its steps, its
 * MISSes and its failure lines all disappear — and the tour is walked again from the start
 * against a fresh Worker. Only a walk that ran end to end on a live API is allowed to say
 * anything about the tour.
 */
async function walkTourResilient(t) {
  for (let attempt = 1; attempt <= MAX_TOUR_ATTEMPTS; attempt++) {
    const mark = { totalSteps, missing, failures: failures.length }
    try {
      // Inside the try: a Worker that dies during the recycle or the reload is the same event as
      // one that dies mid-tour, and gets the same retry rather than an unhandled rejection.
      if (await recycled()) await resetPage()
      await walkTour(t)
      return
    } catch (err) {
      if (!(err instanceof WorkerDownError)) throw err
      totalSteps = mark.totalSteps
      missing = mark.missing
      failures.length = mark.failures
      console.log(`[worker] "${t.label}" was interrupted: ${err.message}`)
      if (attempt === MAX_TOUR_ATTEMPTS) break
      // Counted after the break, so the number is re-walks and not interruptions — the last
      // interruption of an abandoned tour is followed by nothing.
      workerRetries++
      await worker.restart(`"${t.label}" needs a live API to be walked at all`)
      await resetPage()
      console.log(
        `[worker] re-walking "${t.label}" from the start ` +
          `(attempt ${attempt + 1} of ${MAX_TOUR_ATTEMPTS})`
      )
    }
  }
  unproven.push(t.label)
  console.log(
    `[worker] giving up on "${t.label}": the Worker died under it ${MAX_TOUR_ATTEMPTS} times. ` +
      `This is a wrangler crash, NOT a tour failure — the tour is unproven, not broken.`
  )
}

/** Recycle a Worker that is close to the age this build dies at; true when a fresh one started. */
async function recycled() {
  try {
    return await worker.recycleIfStale()
  } catch (err) {
    console.error(`\nFATAL: could not bring the Worker back up on :${API_PORT}.\n${err.message}`)
    await worker.stop()
    await browser.close()
    process.exit(2)
  }
}

try {
  for (const t of TOURS) {
    if (ONLY && t.id !== ONLY) continue
    await walkTourResilient(t)
  }
} catch (err) {
  /*
   * Anything the per-tour retry did not absorb — a browser that closed, a page that never came
   * back. Exit 1 here would file it under "tour regression", which is the one thing it must
   * never be if the Worker was down at the time, so decide that before choosing a code.
   */
  const workerDown = worker.isDown || err instanceof WorkerDownError
  console.error(`\nFATAL: the walk stopped early — ${err?.message || err}`)
  console.error(
    workerDown
      ? 'The Worker was down when it happened, so nothing here says the tours are broken. Re-run.'
      : 'The Worker was up, so this is not a Worker problem — read the error above.'
  )
  await worker.stop()
  await browser.close().catch(() => {})
  process.exit(workerDown ? 2 : 1)
}
await worker.stop()

console.log(`\nTOTAL steps: ${totalSteps}, steps without a visible spotlight: ${missing}`)
console.log(
  `Worker: ${worker.summary()}, ${workerRetries} tour re-walk${workerRetries === 1 ? '' : 's'}. ` +
    `None of that is a tour failure.`
)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
}
if (unproven.length) {
  console.log(
    `\nUNPROVEN — the Worker would not stay up long enough to walk ${unproven.length} tour(s):`
  )
  for (const u of unproven) console.log(`  - ${u}`)
  console.log('  These are wrangler crashes. Re-run; nothing here says the tours are broken.')
}

/*
 * The verdict, in words, on its own line.
 *
 * The exit code already says this, and the exit code is what a human skims past. Two non-zero
 * exits mean opposite things here — 1 is "the tours are broken", 2 is "the tours were never
 * tested" — and reading the second as the first is the whole confusion this script was rewritten
 * to end. So say which one it is.
 */
if (missing > 0) {
  console.log(`\nGATE: FAILED — ${missing} step(s) MISSed. This is a real tour regression.`)
} else if (unproven.length) {
  console.log(
    `\nGATE: UNPROVEN — the Worker would not stay up, so ${unproven.length} tour(s) were never ` +
      `walked. NOT a pass, and NOT a tour failure. Re-run.`
  )
} else {
  console.log('\nGATE: PASSED — every step of every tour spotlighted a visible element.')
}
await browser.close()
process.exit(missing > 0 ? 1 : unproven.length > 0 ? 2 : 0)
