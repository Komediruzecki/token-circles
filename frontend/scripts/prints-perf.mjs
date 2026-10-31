// ============================================================
// prints-perf: what Progress's Prints section costs on a slow phone, in the built app.
//
// Opens the app local-first on the example profiles (every month from 2000-01, so 26 prints and a
// plate) at 390x844 and DPR 3, throttles the CPU through CDP, opens Progress and records the main
// thread's long tasks in two windows:
//
//   open    from asking for Progress until its Prints divider is on the page: the page's first
//           render (circles, advice, badges). The shelf waits for the task after it, so this is
//           reported, not judged.
//   prints  from then until every print's image is in: the shelf worked out and drawn, then the
//           strip of prints scrolled to its end, since an image is drawn only once it comes near
//           the screen.
//
// Budget (phase 4 design, section 7): no task over 50 ms in the prints window at 4x.
//
// Run it by hand before a release, not in CI, where load invents timings. Against a production
// build, on a port of your own:
//   cd frontend && pnpm exec vite build --outDir <dir> && pnpm exec vite preview --outDir <dir> \
//     --port 3995 --strictPort
//   BASE_URL=http://127.0.0.1:3995 node scripts/prints-perf.mjs
//
// Env vars:
//   BASE_URL   app URL (default http://127.0.0.1:3800)
//   CPU        throttle rates to measure, comma-separated (default 1,4,6)
//   RUNS       runs per rate; the median is reported (default 5)
//   CHROMIUM   chromium executable path (optional)
//
// Exit codes: 0 within budget, 1 over it, 2 could not measure.
// ============================================================
import { chromium, selectors } from '@playwright/test'

const BASE = process.env.BASE_URL || `http://127.0.0.1:${process.env.E2E_PORT || 3800}`
const RATES = (process.env.CPU || '1,4,6').split(',').map(Number)
const RUNS = Number(process.env.RUNS || 5)
const BUDGET_MS = 50
const BUDGET_RATE = 4
const PRINTS = 26

// The app's test ids, as playwright.config.ts names the attribute.
selectors.setTestIdAttribute('data-test-id')

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

async function oneRun(browser, rate) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  try {
    await context.addInitScript(() => {
      localStorage.setItem('finance_storage_mode', 'serverless')
      window.__longTasks = []
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__longTasks.push({ start: e.startTime, ms: e.duration })
        }
      }).observe({ type: 'longtask', buffered: true })
    })
    const page = await context.newPage()
    await page.goto(`${BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    // The example profiles are written on first load; the badges' snapshot follows them.
    await page.getByTestId('dashboard-header').waitFor({ timeout: 60_000 })
    await page.waitForTimeout(3000)

    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })

    // Asked for from inside a page task, so the work it starts is seen by the observer.
    const t0 = await page.evaluate(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            const at = performance.now()
            window.location.hash = 'progress'
            resolve(at)
          }, 0)
        })
    )
    await page.getByTestId('progress-divider-prints').waitFor({ timeout: 60_000 })
    const t1 = await page.evaluate(() => performance.now())
    await page.getByTestId('prints-seal').waitFor({ timeout: 60_000 })
    await page.getByTestId('progress-prints').scrollIntoViewIfNeeded()
    const strip = page.getByTestId('prints-every')
    await strip.waitFor({ timeout: 30_000 })
    const deadline = Date.now() + 60_000
    let images = 0
    while (Date.now() < deadline) {
      images = await strip.locator('img').count()
      if (images >= PRINTS) break
      // Along the strip a little at a time, as a thumb would.
      await strip.evaluate((el) => el.scrollBy({ left: 300 }))
      await page.waitForTimeout(150)
    }
    await page.waitForTimeout(500)
    const t2 = await page.evaluate(() => performance.now())
    const tasks = await page.evaluate(() => window.__longTasks)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

    const within = (from, to) => tasks.filter((t) => t.start >= from && t.start < to)
    const open = within(t0, t1)
    const prints = within(t1, t2)
    return {
      openMs: t1 - t0,
      openLongest: Math.max(0, ...open.map((t) => t.ms)),
      printsMs: t2 - t1,
      printsLongest: Math.max(0, ...prints.map((t) => t.ms)),
      printsOver: prints.filter((t) => t.ms > BUDGET_MS).length,
      images,
    }
  } finally {
    await context.close()
  }
}

const launchOpts = { headless: true }
if (process.env.CHROMIUM) launchOpts.executablePath = process.env.CHROMIUM
let browser
try {
  browser = await chromium.launch(launchOpts)
} catch (e) {
  console.error(`Could not start Chromium: ${e.message}`)
  process.exit(2)
}

let over = false
try {
  console.log(`prints-perf: ${BASE}, 390x844 DPR 3, ${RUNS} runs per rate, median shown`)
  for (const rate of RATES) {
    const runs = []
    for (let i = 0; i < RUNS; i++) runs.push(await oneRun(browser, rate))
    const short = runs.filter((r) => r.images < PRINTS)
    if (short.length > 0) {
      console.error(`${rate}x: only ${Math.min(...short.map((r) => r.images))} of ${PRINTS} images`)
      process.exitCode = 2
    }
    const worst = Math.max(...runs.map((r) => r.printsLongest))
    console.log(
      `${rate}x  open ${median(runs.map((r) => r.openMs)).toFixed(0)} ms, longest task ` +
        `${median(runs.map((r) => r.openLongest)).toFixed(0)} ms (the page before the shelf)  |  prints ` +
        `${median(runs.map((r) => r.printsMs)).toFixed(0)} ms, longest task ` +
        `${median(runs.map((r) => r.printsLongest)).toFixed(0)} ms, worst run ${worst.toFixed(0)} ms, ` +
        `${runs.reduce((n, r) => n + r.printsOver, 0)} over ${BUDGET_MS} ms in all runs`
    )
    if (rate === BUDGET_RATE && worst > BUDGET_MS) over = true
  }
} catch (e) {
  console.error(`Could not measure: ${e.message}`)
  process.exitCode = 2
} finally {
  await browser.close()
}
if (process.exitCode !== 2) {
  console.log(over ? `OVER BUDGET at ${BUDGET_RATE}x` : `Within budget at ${BUDGET_RATE}x`)
  process.exitCode = over ? 1 : 0
}
