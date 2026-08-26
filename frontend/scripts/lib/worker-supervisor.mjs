// ============================================================
// worker-supervisor — own the local `wrangler dev` for the length of a browser run.
//
// This is defence-in-depth, not a fix for any one bug. A `wrangler dev` that dies under a browser
// run is indistinguishable, from the browser's side, from the app breaking: pages render empty
// states, spotlights find nothing to point at, and the run reports a UI regression that never
// happened. Five consecutive guided-tour "failures" turned out to be exactly that.
//
// The death that prompted this one:
//
//   [ERROR] Error in ProxyController: Error inside ProxyWorker
//     cause: { message: 'Network connection lost.' }
//     at castErrorCause -> emitErrorEvent -> onProxyWorkerMessage
//
// The ProxyWorker websocket to workerd drops, ProxyController treats that as fatal, and the
// process exits — observed at `durationMs` 104348 and 59964 in separate runs, so one to two and a
// half minutes after startup, and not deterministic.
//
// **There is no version to pin your way out of it.** It reproduces identically on wrangler
// 4.116.0 with stable miniflare 4.20260730.0 and on 4.126.0 with the miniflare 5 alpha: same
// stack, same `Network connection lost` cause. It is an upstream `wrangler dev` bug, so surviving
// it is the only fix available.
//
// **And the crash never reaches stdout.** All wrangler prints there is an empty `[ERROR]`; the
// ProxyController stack and its cause go only to the debug log under ~/.config/.wrangler/logs/
// (.github/workflows/e2e.yml uploads that directory for exactly this reason). Grepping a job log
// for the signature comes back empty on runs that crashed, which has already sent one
// investigation down a wrong root cause. So this class does not look for the signature at all —
// it watches the process and the health endpoint, neither of which can be silent about it.
//
// This class starts wrangler, watches it (process exit AND a health poll, because a wedged worker
// never exits), restarts it, and recycles it before it reaches an age at which it is known to
// die. Callers ask `assertUpNow()` before they blame the app for anything.
//
// Nothing here is specific to the tour walk; any script that drives the app for minutes wants it.
// ============================================================
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { resolve } from 'node:path'

/** The worker went away underneath whatever the caller was doing. Never a fault of the app. */
export class WorkerDownError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WorkerDownError'
  }
}

const HEALTH_TIMEOUT_MS = 2500
const WATCHDOG_INTERVAL_MS = 3000
// Two consecutive misses, not one: a single dropped probe while the machine is busy driving a
// browser is not a death, and calling it one costs a restart plus a re-walk.
const WATCHDOG_STRIKES = 2
const START_TIMEOUT_MS = 60000
const KILL_GRACE_MS = 5000
const PORT_FREE_TIMEOUT_MS = 20000
const LOG_TAIL_LINES = 12
/*
 * Hints that wrangler is on its way out. Only an accelerator: a match forces an immediate health
 * probe instead of waiting up to a watchdog tick, and proves nothing on its own.
 *
 * The bare cross is what actually fires. wrangler's dying breath on stdout is an empty `[ERROR]`
 * marker and nothing else — the named errors below go to the debug log file, not here — so
 * matching only those would mean this never triggers. Detection does not depend on any of it.
 */
const DEATH_HINT =
  /\u2718|Error in ProxyController|Error inside ProxyWorker|Network connection lost/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Kill wrangler AND the workerd it forked. See the `detached` note in #spawn. */
function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  }
}

/**
 * Has this child already gone?
 *
 * Both halves matter: a normal exit sets `exitCode` and leaves `signalCode` null, a kill sets
 * `signalCode` and leaves `exitCode` null. Testing only the first made `#kill` wait on an 'exit'
 * event that had already fired, which hung the whole run the moment a crash was followed by a
 * restart — the exact path this module exists for.
 */
const hasExited = (child) => child.exitCode !== null || child.signalCode !== null

function portInUse(port) {
  return new Promise((res) => {
    const sock = connect({ host: '127.0.0.1', port })
    const done = (v) => {
      sock.destroy()
      res(v)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.setTimeout(1000, () => done(false))
  })
}

export class WorkerSupervisor {
  /**
   * @param {object} opts
   * @param {number} opts.port          the port the app's /api proxy forwards to
   * @param {string} opts.workerDir     directory holding wrangler.toml and node_modules/.bin
   * @param {number} [opts.maxUptimeMs] recycle a worker older than this between units of work;
   *                                    0 disables recycling and leaves only crash recovery
   * @param {(msg: string) => void} [opts.log]
   */
  constructor({ port, workerDir, maxUptimeMs = 0, log = console.log }) {
    this.port = port
    this.workerDir = workerDir
    this.maxUptimeMs = maxUptimeMs
    this.base = `http://127.0.0.1:${port}`
    this.log = (msg) => log(`[worker] ${msg}`)

    /** @type {import('node:child_process').ChildProcess | null} ours to kill; null when adopted */
    this.child = null
    /** 'stopped' | 'starting' | 'up' | 'down' */
    this.state = 'stopped'
    /** Someone else's wrangler is on the port. We can watch it; we must not kill it. */
    this.adopted = false
    /** Sticky: `adopted` clears the moment we take the port over, and the summary still cares. */
    this.everAdopted = false
    this.startedAt = 0
    /** How many wranglers this supervisor has spawned. */
    this.starts = 0
    /** How many deaths it has observed — the number that must never be read as a tour failure. */
    this.crashes = 0
    this.downReason = ''
    this.tail = []
    this.strikes = 0
    this.timer = null
    this.probing = false
    this.cleanupBound = false
  }

  get uptimeMs() {
    return this.startedAt ? Date.now() - this.startedAt : 0
  }

  get isDown() {
    return this.state === 'down'
  }

  /**
   * Adopt a worker already on the port, or spawn one. Resolves once /api/health answers.
   *
   * Adoption exists because the documented setup leaves a wrangler running in another terminal,
   * and killing a process someone else started is not this script's call. An adopted worker still
   * gets watched, and the first time it dies its port frees and we take over with a managed one —
   * which is the whole point, so nothing needs to be torn down by hand first.
   */
  async start() {
    if (await this.#healthy()) {
      this.adopted = true
      this.everAdopted = true
      this.state = 'up'
      this.startedAt = Date.now()
      this.log(
        `already listening on :${this.port} — using it. It is not ours to kill or recycle, so ` +
          `the first time it dies a managed one takes its place.`
      )
      this.#watch()
      return
    }
    await this.#spawnWithRetry(`nothing was listening on :${this.port}`)
  }

  /** Cheap: the flag the watchdog and the exit handler maintain. */
  assertUp(what) {
    if (this.state === 'down') throw new WorkerDownError(`${this.downReason}, during ${what}`)
  }

  /**
   * Authoritative: probe now, twice, before letting the caller record a failure.
   *
   * The watchdog runs on a 3s tick and a step can fail inside that window, so the cached flag
   * alone would let a death be filed as a missing highlight — the exact confusion this module
   * exists to end. Two probes because one timeout under load is not proof.
   */
  async assertUpNow(what) {
    this.assertUp(what)
    if (await this.#healthy()) return
    await sleep(750)
    if (await this.#healthy()) return
    this.#markDown(`${this.base}/api/health stopped answering`)
    throw new WorkerDownError(`${this.downReason}, during ${what}`)
  }

  /**
   * Restart between units of work if the worker is dead, or old enough to be about to die.
   *
   * Recycling is cheaper than the alternative: a restart costs a few seconds, while a death
   * mid-unit costs the restart AND a re-run of everything that unit had already done.
   *
   * @returns {Promise<boolean>} whether a fresh worker was started
   */
  async recycleIfStale() {
    if (this.state === 'down') {
      await this.restart('it had already died')
      return true
    }
    if (!this.maxUptimeMs || this.adopted || this.state !== 'up') return false
    if (this.uptimeMs < this.maxUptimeMs) return false
    await this.restart(
      `up ${Math.round(this.uptimeMs / 1000)}s, past the ${Math.round(this.maxUptimeMs / 1000)}s ` +
        `recycle mark this wrangler build cannot reliably outlive`
    )
    return true
  }

  async restart(why) {
    this.#unwatch()
    if (this.child) await this.#kill()
    else if (this.adopted) this.log('the adopted worker is gone — taking the port over')
    this.adopted = false
    await this.#waitForPortFree()
    await this.#spawnWithRetry(why)
  }

  async stop() {
    this.#unwatch()
    this.state = 'stopped'
    await this.#kill()
  }

  /** One line for the run's summary, so crashes are counted separately from real failures. */
  summary() {
    const parts = [`${this.starts} start${this.starts === 1 ? '' : 's'}`]
    if (this.everAdopted) parts.unshift('1 adopted')
    parts.push(`${this.crashes} crash${this.crashes === 1 ? '' : 'es'} recovered`)
    return parts.join(', ')
  }

  /**
   * A start that fails is usually terminal (no wrangler, a busy port, a broken wrangler.toml),
   * but not always — workerd occasionally loses a race with a port it has just released. One
   * retry separates the two without papering over the terminal case.
   */
  async #spawnWithRetry(why) {
    try {
      await this.#spawn(why)
    } catch (err) {
      this.log(`start failed: ${err.message}`)
      this.log('retrying once before giving up')
      await sleep(2000)
      await this.#waitForPortFree()
      await this.#spawn(`${why} (retry)`)
    }
  }

  async #spawn(why) {
    // The worker's own wrangler, by path. Not `npx wrangler`: resolving a binary off PATH is how
    // a harness ends up running something other than the tool it meant to. Same rule as
    // tests/global.setup.ts.
    const bin = resolve(this.workerDir, 'node_modules', '.bin', 'wrangler')
    if (!existsSync(bin)) {
      throw new Error(`no wrangler at ${bin} — run pnpm install in ${this.workerDir}`)
    }

    this.state = 'starting'
    this.tail = []
    this.starts++
    this.log(`starting wrangler dev on :${this.port} (start ${this.starts}) — ${why}`)
    const t0 = Date.now()

    const child = spawn(bin, ['dev', '--port', String(this.port)], {
      cwd: this.workerDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group. wrangler forks workerd, and killing only the parent leaves that
      // child holding the port — which turns the next start into an EADDRINUSE mystery.
      detached: true,
    })
    this.child = child

    const absorb = (buf) => {
      const text = String(buf)
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        this.tail.push(line.trimEnd())
        if (this.tail.length > LOG_TAIL_LINES) this.tail.shift()
      }
      if (DEATH_HINT.test(text) && this.state === 'up') void this.#probeNow()
    }
    child.stdout.on('data', absorb)
    child.stderr.on('data', absorb)
    // `this.child !== child` means we asked for this exit; #kill has already detached it.
    child.on('exit', (code, signal) => {
      if (this.child !== child) return
      this.#markDown(`wrangler exited (${signal ? `signal ${signal}` : `code ${code}`})`)
    })
    child.on('error', (err) => {
      if (this.child !== child) return
      this.#markDown(`wrangler could not be run: ${err.message}`)
    })
    this.#installExitCleanup()

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (hasExited(child)) {
        this.child = null
        this.state = 'down'
        throw new Error(`wrangler exited while starting up:\n${this.#tailText()}`)
      }
      if (await this.#healthy()) {
        this.state = 'up'
        this.startedAt = Date.now()
        this.strikes = 0
        this.log(`up in ${((Date.now() - t0) / 1000).toFixed(1)}s (pid ${child.pid})`)
        this.#watch()
        return
      }
      await sleep(500)
    }
    await this.#kill()
    this.state = 'down'
    throw new Error(
      `wrangler never answered ${this.base}/api/health within ` +
        `${START_TIMEOUT_MS / 1000}s:\n${this.#tailText()}`
    )
  }

  async #kill() {
    const child = this.child
    this.child = null
    if (!child || hasExited(child)) return
    const exited = new Promise((r) => {
      if (hasExited(child)) return r()
      child.once('exit', r)
    })
    killGroup(child, 'SIGTERM')
    const hard = setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS)
    // Bounded even so: a process wedged past SIGKILL (uninterruptible I/O) must not take the run
    // down with it. #waitForPortFree is what actually decides whether the port came back.
    await Promise.race([exited, sleep(KILL_GRACE_MS * 2)])
    clearTimeout(hard)
  }

  async #waitForPortFree() {
    const deadline = Date.now() + PORT_FREE_TIMEOUT_MS
    while (await portInUse(this.port)) {
      if (Date.now() > deadline) {
        throw new Error(
          `:${this.port} is still held ${PORT_FREE_TIMEOUT_MS / 1000}s after the worker went ` +
            `away — something else has it. Stop that and re-run.`
        )
      }
      await sleep(500)
    }
  }

  async #healthy() {
    try {
      const res = await fetch(`${this.base}/api/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
      return res.ok
    } catch {
      return false
    }
  }

  #watch() {
    this.#unwatch()
    this.strikes = 0
    this.timer = setInterval(() => void this.#probeNow(), WATCHDOG_INTERVAL_MS)
    // Never the reason the process stays alive.
    this.timer.unref()
  }

  #unwatch() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async #probeNow() {
    if (this.state !== 'up' || this.probing) return
    this.probing = true
    try {
      if (await this.#healthy()) {
        this.strikes = 0
        return
      }
      this.strikes++
      if (this.strikes >= WATCHDOG_STRIKES) {
        this.#markDown(`${this.base}/api/health stopped answering`)
      }
    } finally {
      this.probing = false
    }
  }

  #markDown(reason) {
    if (this.state === 'down' || this.state === 'stopped') return
    this.#unwatch()
    const upFor = Math.round(this.uptimeMs / 1000)
    this.state = 'down'
    this.crashes++
    this.downReason = `the worker died — ${reason} after ${upFor}s up`
    this.log(`DIED — ${reason} after ${upFor}s up`)
    for (const line of this.tail) this.log(`  | ${line}`)
  }

  #tailText() {
    return this.tail.length ? this.tail.map((l) => `  | ${l}`).join('\n') : '  | (no output)'
  }

  /**
   * Never leave a wrangler (or its workerd) behind, however this process ends. Ctrl-C during a
   * ten-minute walk used to strand one holding :8787, and the next run then adopted a worker
   * nobody could account for.
   */
  #installExitCleanup() {
    if (this.cleanupBound) return
    this.cleanupBound = true
    // Synchronous only — 'exit' handlers cannot await.
    const hard = () => {
      if (this.child) killGroup(this.child, 'SIGKILL')
    }
    process.once('exit', hard)
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.once(sig, () => {
        hard()
        process.exit(130)
      })
    }
  }
}
