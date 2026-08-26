// ============================================================
// serve-worker — a Playwright `webServer` that keeps `wrangler dev` alive for the whole suite.
//
// Playwright starts the Worker once, at the top of a run, and never touches it again. That is
// fine for a server that stays up. `wrangler dev` does not: it has an upstream crash that kills it
// one to two minutes into a run (the ProxyWorker websocket to workerd drops and ProxyController
// treats it as fatal). Nothing restarts it, so from the crash onward every request the vite proxy
// forwards gets a 502, and every remaining spec in the shard fails against a dead API — a run that
// reads as a hundred broken tests and is really one dead process. It is the same crash the guided
// tour gate hit (see scripts/lib/worker-supervisor.mjs), reached a different way.
//
// This wrapper hands the Worker to that same supervisor and stays running as the webServer:
// Playwright waits on /api/health, the supervisor restarts wrangler the instant it dies, and
// health comes back within a few seconds. The handful of specs caught mid-request during that
// gap fail and are re-run by Playwright's `retries` — so a crash costs a couple of retried tests
// instead of the rest of the shard.
//
// It does NOT recycle the Worker proactively (maxUptimeMs 0). The tour gate can recycle between
// tours because it knows where the seams are; here there is no test boundary this process can
// see, so a proactive restart would yank the API out from under whatever spec happened to be
// mid-flight. Crash recovery only.
//
// Run by playwright.config.ts's webServer, after `pnpm run d1:migrate:local`. Migrations are not
// this script's job — they run once against a database that outlives every wrangler restart
// (D1 is a directory under worker/.wrangler), so re-applying them on each restart would be
// pointless.
// ============================================================
import { fileURLToPath } from 'node:url'
import { WorkerDownError, WorkerSupervisor } from './lib/worker-supervisor.mjs'

const API_PORT = Number(process.env.E2E_API_PORT || 8787)

// How long the supervisor may keep failing to bring a fresh worker up before we call it dead for
// real and exit non-zero, so Playwright reports "the webServer never came up" instead of running
// the whole suite against nothing. Crash recovery normally succeeds on the first restart; this is
// the backstop for a worker that will not stay up at all (a broken wrangler.toml, a held port).
const MAX_CONSECUTIVE_RESTART_FAILURES = 5
// The supervisor's own exit event marks a death within milliseconds; this only bounds how long we
// might sit in a dead window before noticing on the poll. Short, because it is pure downtime.
const MONITOR_INTERVAL_MS = 400

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const worker = new WorkerSupervisor({
  port: API_PORT,
  workerDir: fileURLToPath(new URL('../../worker/', import.meta.url)),
  // Crash recovery only — never a proactive restart under a running spec. See the header.
  maxUptimeMs: 0,
})

// The supervisor installs its own SIGINT/SIGTERM cleanup (it kills wrangler's process group and
// exits), which is exactly what Playwright's teardown needs, so this wrapper adds none of its own.

try {
  await worker.start()
} catch (err) {
  console.error(`\nFATAL: the Worker could not start on :${API_PORT}.\n${err.message}`)
  process.exit(1)
}

// Stay alive as the webServer, and restart wrangler whenever it dies. A ref'd timer would do to
// keep the process up, but an await-loop makes the restart itself awaitable so two deaths in quick
// succession cannot overlap two restarts.
let consecutiveFailures = 0
// eslint-disable-next-line no-constant-condition -- runs until Playwright signals teardown
while (true) {
  await sleep(MONITOR_INTERVAL_MS)
  if (!worker.isDown) {
    consecutiveFailures = 0
    continue
  }
  try {
    await worker.restart('recovering from a wrangler crash under the e2e suite')
    consecutiveFailures = 0
  } catch (err) {
    consecutiveFailures++
    console.error(
      `[worker] restart failed (${consecutiveFailures}/${MAX_CONSECUTIVE_RESTART_FAILURES}): ` +
        (err instanceof WorkerDownError ? err.message : err?.message || err)
    )
    if (consecutiveFailures >= MAX_CONSECUTIVE_RESTART_FAILURES) {
      console.error('\nFATAL: the Worker would not stay up. Giving up so the suite fails fast.')
      await worker.stop().catch(() => {})
      process.exit(1)
    }
    await sleep(2000)
  }
}
