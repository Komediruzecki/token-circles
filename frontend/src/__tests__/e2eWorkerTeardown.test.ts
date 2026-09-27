/**
 * Stopping the e2e Worker has to stop wrangler with it.
 *
 * Playwright starts every `webServer` command as the leader of a new process group, and ends the
 * run by signalling that group. Unless the entry sets `gracefulShutdown`, that signal is SIGKILL.
 * The Worker entry runs scripts/serve-worker.mjs, whose supervisor stops wrangler from a
 * SIGINT/SIGTERM handler, and a SIGKILL runs no handler. Nothing else stops wrangler either: the
 * supervisor spawns it `detached`, in a group of its own so that a restart also kills the workerd
 * it forked, and that puts it out of reach of Playwright's kill too.
 *
 * So every local `pnpm test:e2e` left a `wrangler dev` group running after it exited, re-parented
 * to init and still holding :8787. The next run's `reuseExistingServer` adopted it, and local E2E
 * then tested whatever code that orphan had started with, possibly another branch's. Seen on two
 * consecutive runs on 2026-09-27.
 *
 * This runs the real serve-worker.mjs and supervisor, stops them the way Playwright stops the entry
 * configured in playwright.config.ts, and checks that nothing is left. Only wrangler is a stand-in:
 * the real one takes seconds to start and needs a D1.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is this test's own: its
   mkdtemp, the scripts/ it copies, and /proc. */
import { spawn } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import playwrightConfig from '../../playwright.config'
import type { ChildProcess } from 'node:child_process'
import type { AddressInfo } from 'node:net'

const FRONTEND = resolve(__dirname, '../..')

/**
 * wrangler's stand-in. Like the real one it forks a child (workerd) into its own process group and
 * answers /api/health on the port it is given, here with both pids so the test knows what to find.
 */
const FAKE_WRANGLER = `
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const workerd = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore' })
createServer((_req, res) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ wrangler: process.pid, workerd: workerd.pid }))
}).listen(port, '127.0.0.1')
`

interface Pids {
  wrangler: number
  workerd: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

/** The Worker entry: the one that runs serve-worker.mjs. */
function workerEntry() {
  const entry = [playwrightConfig.webServer ?? []]
    .flat()
    .find((server) => server.command?.includes('scripts/serve-worker.mjs'))
  if (!entry) throw new Error('playwright.config.ts has no webServer that runs serve-worker.mjs')
  return entry
}

/**
 * A copy of frontend/scripts beside a stand-in worker/. serve-worker.mjs finds the worker at
 * ../../worker/ from itself, so the copy runs the real supervisor against the stand-in.
 */
function stage(root: string) {
  cpSync(join(FRONTEND, 'scripts'), join(root, 'frontend', 'scripts'), { recursive: true })
  const worker = join(root, 'worker')
  mkdirSync(join(worker, 'node_modules', '.bin'), { recursive: true })
  writeFileSync(join(worker, 'fake-wrangler.mjs'), FAKE_WRANGLER)
  // A shell shim that execs node, as pnpm's node_modules/.bin/wrangler does.
  const shim = join(worker, 'node_modules', '.bin', 'wrangler')
  const target = join(worker, 'fake-wrangler.mjs')
  writeFileSync(
    shim,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(target)} "$@"\n`
  )
  chmodSync(shim, 0o700)
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const server = createServer()
    server.once('error', rej)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => {
        res(port)
      })
    })
  })
}

/**
 * Whatever answers /api/health on the port, if anything. node:http rather than fetch, because under
 * jsdom `AbortSignal` is jsdom's, and Node's fetch rejects it.
 */
function health(port: number): Promise<Pids | null> {
  return new Promise((res) => {
    const req = get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (response) => {
      let body = ''
      response.on('data', (chunk: Buffer) => (body += String(chunk)))
      response.on('end', () => {
        try {
          res(JSON.parse(body) as Pids)
        } catch {
          res(null)
        }
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => {
      res(null)
    })
  })
}

/** Still running, as opposed to gone or dead but unreaped: a zombie still answers signal 0. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  let stat: string
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  } catch {
    // No such entry on Linux means it has gone since; elsewhere there is no /proc to ask.
    return process.platform !== 'linux'
  }
  return stat[stat.lastIndexOf(')') + 2] !== 'Z'
}

async function stillRunning(pids: number[], withinMs: number): Promise<number[]> {
  const deadline = Date.now() + withinMs
  for (;;) {
    const running = pids.filter(isRunning)
    if (!running.length || Date.now() > deadline) return running
    await sleep(100)
  }
}

function killGroup(pgid: number | undefined) {
  if (!pgid) return
  try {
    process.kill(-pgid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

/**
 * Start the command the way Playwright starts a webServer: through a shell, and `detached`, which
 * makes it the leader of a new process group, the group that teardown signals.
 */
function launch(command: string, cwd: string, port: number) {
  const child = spawn(command, {
    shell: true,
    detached: true,
    cwd,
    env: { ...process.env, E2E_API_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += String(chunk)))
  child.stderr.on('data', (chunk: Buffer) => (output += String(chunk)))
  return { child, output: () => output }
}

async function waitForHealth(port: number, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`serve-worker.mjs exited before the worker came up:\n${output()}`)
    }
    const pids = await health(port)
    if (pids) return pids
    await sleep(100)
  }
  throw new Error(`nothing answered /api/health on :${port} within 20s:\n${output()}`)
}

/**
 * Stop it the way Playwright's webServer teardown does (`attemptToGracefullyClose`, checked against
 * playwright 1.63): with `gracefulShutdown`, send its signal to the process group and wait up to its
 * timeout for the command to close; without it, or past that timeout, SIGKILL the group.
 */
async function stopLikePlaywright(
  child: ChildProcess,
  graceful: { signal: NodeJS.Signals; timeout: number } | undefined
) {
  const closed = new Promise<boolean>((res) =>
    child.once('close', () => {
      res(true)
    })
  )
  // Never default this to 0: kill(-0) signals this test's own process group.
  const pgid = child.pid
  if (pgid === undefined) throw new Error('the webServer command never started')
  if (graceful) {
    process.kill(-pgid, graceful.signal)
    const timedOut = graceful.timeout
      ? sleep(graceful.timeout).then(() => false)
      : new Promise<boolean>(() => undefined)
    if (await Promise.race([closed, timedOut])) return
  }
  killGroup(pgid)
  await closed
}

describe.skipIf(process.platform === 'win32')('the e2e Worker webServer', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  })

  it('leaves no wrangler running once Playwright has stopped it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-worker-teardown-'))
    cleanups.push(() => {
      rmSync(root, { recursive: true, force: true })
    })
    stage(root)
    const port = await freePort()

    const entry = workerEntry()
    // Everything before the last `&&` is setup that has finished before the server starts (the D1
    // migration). `true` stands in for it, so the shell still runs a `setup && server` list.
    const command = entry.command!.replace(/^.*&&/, 'true &&')
    const { child, output } = launch(command, join(root, 'frontend'), port)
    cleanups.push(() => {
      killGroup(child.pid)
    })

    const pids = await waitForHealth(port, child, output)
    // The stand-in runs in a group of its own, as wrangler does. A failure leaves exactly that.
    cleanups.push(() => {
      killGroup(pids.wrangler)
    })

    await stopLikePlaywright(child, entry.gracefulShutdown)

    expect(
      await stillRunning([pids.wrangler, pids.workerd], 5000),
      'wrangler, and the workerd it forked, outlived the Worker webServer. Both halves have to ' +
        'hold: its entry in playwright.config.ts needs a gracefulShutdown signal (without one, ' +
        'Playwright SIGKILLs the group, and a SIGKILL runs no handler), and ' +
        `scripts/lib/worker-supervisor.mjs has to stop wrangler on that signal.\n${output()}`
    ).toEqual([])
    expect(await health(port), `something still answers on :${port}`).toBeNull()
  }, 30_000)
})
