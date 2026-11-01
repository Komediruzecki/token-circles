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
//   PLACEMENT_JSON        write every step's viewport, highlight and tip rects to this file
//
// Exit codes:
//   0  every step of every tour spotlighted a visible element, and no tip covered its target
//      where the screen had room for both
//   1  at least one step MISSed or was covered by its own tip — a real tour regression, listed
//      under "Failures"
//   2  the Worker could not be kept alive long enough to prove the tours either way
// ============================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
const PLACEMENT_JSON = process.env.PLACEMENT_JSON || ''

// A spotlight rect smaller than this is a mis-anchored step (a collapsed or zero-size
// element), not a real highlight.
const MIN_HIGHLIGHT_PX = 14

// How far the tip must stay from the highlight's edge to count as beside it, and from the screen
// edge to count as on screen. The highlight is the target padded by 6px and the engine keeps the
// tip 8px off the target and 12px off the screen edge, so the tip needs 12 + 2 = 14px of slack
// past its own size on one side of the highlight. Below that, covering part of the target is the
// only option there is, and the step is reported but not failed.
const ROOM_EDGE_PX = 14

/*
 * Where the tip sits relative to what it points at.
 *
 * A spotlight can land on the right element and still be useless: on a phone the tip used to sit
 * on top of a full-width target, hiding the very thing the step describes. That is invisible to
 * the highlight-size check above, so measure it: the tip's rect against the highlight's visible
 * part, and whether the screen had room to put the tip beside it instead.
 */
async function readPlacement() {
  return page
    .evaluate(() => {
      const tip = document.querySelector('[class*="stepCounter"]')?.parentElement
      const glow = document.querySelector('svg[class*="backdropSvg"] rect[stroke-width="2"]')
      if (!tip || !glow) return null
      const t = tip.getBoundingClientRect()
      const num = (a) => Number(glow.getAttribute(a))
      return {
        // The tip fades in with a translate, and until it has its visible class it can still be
        // sitting where the last step put it.
        shown: /visible/.test(tip.className),
        vw: window.innerWidth,
        vh: window.innerHeight,
        tip: { x: t.x, y: t.y, w: t.width, h: t.height },
        target: { x: num('x'), y: num('y'), w: num('width'), h: num('height') },
      }
    })
    .catch(() => null)
}

/**
 * The placement once it has stopped moving.
 *
 * A step that has found its target can still be scrolling it into view, and one reading then
 * catches the tip and highlight mid-move. Read until two readings 150ms apart agree, for up to 3s.
 * Null with `shown: false` means the tip was not shown in that time; waitForStep has normally
 * ruled that out before this runs.
 */
async function measurePlacement() {
  const key = (g) =>
    g?.shown ? [g.tip.x, g.tip.y, g.target.x, g.target.y, g.target.h].map(Math.round).join() : ''
  let last = await readPlacement()
  for (let waited = 0; waited < 3000; waited += 150) {
    await page.waitForTimeout(150)
    const now = await readPlacement()
    if (key(now) && key(now) === key(last)) {
      const { shown, ...geo } = now
      return { geo, shown }
    }
    last = now
  }
  return { geo: null, shown: !!last?.shown }
}

/** The covered area, and whether a tip of this size fits on any side of the target. */
function judgePlacement({ vw, vh, tip, target }) {
  // Only the part of the target on screen can be covered or seen.
  const vis = {
    l: Math.max(0, target.x),
    t: Math.max(0, target.y),
    r: Math.min(vw, target.x + target.w),
    b: Math.min(vh, target.y + target.h),
  }
  const ow = Math.min(vis.r, tip.x + tip.w) - Math.max(vis.l, tip.x)
  const oh = Math.min(vis.b, tip.y + tip.h) - Math.max(vis.t, tip.y)
  // One pixel of slack for sub-pixel rounding at a shared edge.
  const covered = ow > 1 && oh > 1 ? Math.round(ow * oh) : 0
  const visArea = Math.max(0, vis.r - vis.l) * Math.max(0, vis.b - vis.t)
  const fitsV = tip.h <= vh - 2 * 12
  const fitsH = tip.w <= vw - 2 * 12
  const room = {
    above: fitsH && target.y - ROOM_EDGE_PX >= tip.h,
    below: fitsH && vh - (target.y + target.h) - ROOM_EDGE_PX >= tip.h,
    left: fitsV && target.x - ROOM_EDGE_PX >= tip.w,
    right: fitsV && vw - (target.x + target.w) - ROOM_EDGE_PX >= tip.w,
  }
  const hasRoom = room.above || room.below || room.left || room.right
  const pct = visArea > 0 ? Math.round((covered / visArea) * 100) : 0
  return { covered, pct, hasRoom, room }
}

/*
 * How long a step may take to settle. Spotlight.tsx gives a step 6s to find its target (a lazy page
 * chunk and its first fetch can both still be in flight) before it raises the missing-target
 * notice; the rest is slack for a loaded machine.
 */
const STEP_SETTLE_MS = 9000

/**
 * Wait for step `n` (1-based) to settle, and say how: 'found' (the tip is shown for it, so the
 * engine resolved its target), 'missing' (the engine gave up and raised its notice), 'ended' (no
 * tip at all: the tour is over), or, after STEP_SETTLE_MS, 'pending' (still waiting) or
 * 'elsewhere' (the counter shows another step).
 *
 * The walk used to sleep 1.2s and then judge whatever was on screen. A step whose target had not
 * appeared yet was still showing the PREVIOUS step's highlight then, so a missing target passed
 * as "ok" at the old target's size, and the notice that came at 6s was never seen. The Dashboard
 * tour's Charts step did exactly that: its anchor sat behind "Show more", and the walk passed it
 * at the size of the metric cards. Only the counter says which step the tip is on, and the tip's
 * visible class is set in the same update as the new step's highlight, so read both together.
 */
async function waitForStep(n) {
  const deadline = Date.now() + STEP_SETTLE_MS
  for (;;) {
    const state = await page
      .evaluate((want) => {
        const counter = document.querySelector('[class*="stepCounter"]')
        const tip = counter?.parentElement
        if (!counter || !tip) return 'ended'
        const at = Number(counter.textContent.match(/Step (\d+) of/)?.[1])
        if (at !== want) return 'elsewhere'
        // Checked first: the engine shows the tip WITH the notice when it gives up.
        if (tip.querySelector('[class*="targetMissing"]')) return 'missing'
        return /visible/.test(tip.className) ? 'found' : 'pending'
      }, n)
      .catch(() => 'pending')
    if (state === 'found' || state === 'missing' || state === 'ended') return state
    if (Date.now() > deadline) return state
    await page.waitForTimeout(100)
  }
}

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
/** Steps whose tip covered their target although the screen had room for both. */
let covering = 0
/** Steps whose tip covered their target because nothing else fitted. Reported, never failed. */
let coveringNoRoom = 0
/** Steps whose tip or highlight was still moving after 3s, so nothing could be said about them. */
let unsettled = 0
/** Every measured step, for PLACEMENT_JSON. */
const placements = []
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
    // Let the step settle: App.tsx navigates to requiredPage, the page chunk loads lazily, and
    // Spotlight waits up to ~6s for its target via MutationObserver. Judge the step only once
    // the engine has decided about THIS step, never by what the last one left on screen.
    const state = await waitForStep(i + 1)
    // Free — the watchdog has already noticed. Bail before grinding 40 steps through a dead app.
    worker.assertUp(`"${label}" step ${i + 1}`)
    if (state === 'ended') break

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

    // Three signals: whether the engine found this step's target at all (the missing-target
    // notice, or no decision within the budget), and the size of the SVG glow rect it draws
    // around the target it found.
    const flagged = state === 'missing'
    const unresolved = state === 'pending' || state === 'elsewhere'
    const box = await page
      .locator('svg[class*="backdropSvg"] rect[stroke-width="2"]')
      .first()
      .boundingBox()
      .catch(() => null)
    const sized = !!box && box.width > MIN_HIGHLIGHT_PX && box.height > MIN_HIGHLIGHT_PX
    const ok = state === 'found' && sized

    // Before recording a MISS, prove the API was alive for it. A page whose data never arrived
    // renders empty states, and an empty state has nothing to spotlight — which is a true
    // observation about a dead Worker and a false one about the tour.
    if (!ok) await worker.assertUpNow(`"${label}" step ${i + 1} "${title}"`)

    totalSteps++
    if (!ok) {
      missing++
      failures.push(
        `${label} / step ${i + 1} "${title}": ` +
          (flagged
            ? 'app reports target missing'
            : unresolved
              ? `no decision about its target after ${STEP_SETTLE_MS / 1000}s (${state})`
              : 'no visible highlight')
      )
    }

    // A missed step has no target to cover, so only a found one is measured.
    const measured = ok ? await measurePlacement() : { geo: null, shown: false }
    const geo = measured.geo
    const verdict = geo ? judgePlacement(geo) : null
    let placementNote = ''
    if (ok && !geo) {
      unsettled++
      placementNote = measured.shown
        ? '  tip still moving after 3s, placement not measured'
        : '  tip not shown after 3s: still waiting for its target, placement not measured'
    }
    if (geo && verdict) {
      const r = (o) => `${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.w)}x${Math.round(o.h)}`
      placements.push({ tour: id, step: i + 1, title, ...geo, ...verdict })
      placementNote = `  tip ${r(geo.tip)} over target ${r(geo.target)}`
      if (verdict.covered > 0 && verdict.hasRoom) {
        covering++
        const sides = Object.keys(verdict.room).filter((k) => verdict.room[k])
        failures.push(
          `${label} / step ${i + 1} "${title}": the tip covers ${verdict.pct}% of its target ` +
            `although there is room ${sides.join('/')} it`
        )
        placementNote += ` COVERS ${verdict.pct}% (room ${sides.join('/')})`
      } else if (verdict.covered > 0) {
        coveringNoRoom++
        placementNote += ` covers ${verdict.pct}% (no room beside it)`
      }
    }
    const stepOk = ok && !(verdict && verdict.covered > 0 && verdict.hasRoom)
    console.log(
      `  ${stepOk ? 'ok  ' : ok ? 'TIP ' : 'MISS'}  step ${i + 1}: ${title}  ` +
        `${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no-highlight'}` +
        `${flagged ? ' [target-missing banner]' : ''}${unresolved ? ` [${state}]` : ''}${placementNote}`
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
    const mark = {
      totalSteps,
      missing,
      covering,
      coveringNoRoom,
      unsettled,
      failures: failures.length,
      placements: placements.length,
    }
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
      covering = mark.covering
      coveringNoRoom = mark.coveringNoRoom
      unsettled = mark.unsettled
      failures.length = mark.failures
      placements.length = mark.placements
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
  `Tip placement: ${covering} step(s) cover their target although there is room beside it, ` +
    `${coveringNoRoom} cover it because nothing else fits, ${unsettled} could not be measured (tip hidden or still moving).`
)
if (PLACEMENT_JSON) {
  writeFileSync(
    PLACEMENT_JSON,
    JSON.stringify(
      { mobile: MOBILE, covering, coveringNoRoom, unsettled, steps: placements },
      null,
      2
    )
  )
  console.log(`Placements written to ${PLACEMENT_JSON}`)
}
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
if (missing > 0 || covering > 0) {
  const what = [
    missing > 0 ? `${missing} step(s) MISSed` : '',
    covering > 0 ? `${covering} tip(s) covered their target with room to spare` : '',
  ]
    .filter(Boolean)
    .join(', ')
  console.log(`\nGATE: FAILED — ${what}. This is a real tour regression.`)
} else if (unproven.length) {
  console.log(
    `\nGATE: UNPROVEN — the Worker would not stay up, so ${unproven.length} tour(s) were never ` +
      `walked. NOT a pass, and NOT a tour failure. Re-run.`
  )
} else {
  console.log(
    '\nGATE: PASSED — every step of every tour spotlighted a visible element, and no tip ' +
      'covered its target where there was room beside it.'
  )
}
await browser.close()
process.exit(missing > 0 || covering > 0 ? 1 : unproven.length > 0 ? 2 : 0)
