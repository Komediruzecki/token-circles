/**
 * The time machine by hand: start a local stack, move an account through its first week, fire
 * the daily job and read the mails it sent. The same harness the journey spec uses (harness.ts).
 * Run from frontend/ (docs/testing/time-machine.md has the walk-through):
 *
 *   pnpm run time-machine up                       mailbox, Worker and app, until Ctrl+C
 *   pnpm run time-machine day <email> <N> [--at HH:MM]
 *   pnpm run time-machine fire
 *   pnpm run time-machine state <email> [--json]
 *   pnpm run time-machine mails [<email>]
 *   pnpm run time-machine mail <id> [--html]
 *
 * Ports come from E2E_PORT (app), E2E_API_PORT (Worker) and E2E_MAIL_PORT (mailbox), the variables
 * the E2E suite reads, so these commands also work against a running `pnpm test:e2e`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { connect } from 'node:net'
import { resolve } from 'node:path'
import { httpGet, timeMachine } from './harness.ts'
import type { ChildProcess } from 'node:child_process'
import type { WeekState } from '../../../worker/scripts/time-machine.ts'

const env = process.env
const APP_PORT = Number(env.E2E_PORT || 3800)
const API_PORT = Number(env.E2E_API_PORT || 8787)
const MAIL_PORT = Number(env.E2E_MAIL_PORT || 8797)
const APP = `http://127.0.0.1:${String(APP_PORT)}`
const API = `http://127.0.0.1:${String(API_PORT)}`
const MAILBOX = `http://127.0.0.1:${String(MAIL_PORT)}`
const FRONTEND = resolve(import.meta.dirname, '..', '..')
const WORKER = resolve(FRONTEND, '..', 'worker')

const machine = timeMachine({ apiBase: API, mailBase: MAILBOX, workerDir: WORKER })

const USAGE = `Usage, from frontend/:
  pnpm run time-machine up                          start the mailbox, the Worker and the app
  pnpm run time-machine day <email> <N> [--at HH:MM]  move the account to day N of its first week
  pnpm run time-machine fire                        run the daily job once, at the real now
  pnpm run time-machine state <email> [--json]      where the account is in its week
  pnpm run time-machine mails [<email>]             the mails, oldest first
  pnpm run time-machine mail <id> [--html]          one mail: its links and text, or its HTML

Ports: E2E_PORT ${String(APP_PORT)} (app), E2E_API_PORT ${String(API_PORT)} (Worker), E2E_MAIL_PORT ${String(MAIL_PORT)} (mailbox).`

/**
 * A field from a mail, safe to print on one line: every C0 and C1 control character, DEL and
 * Unicode format character (\p{Cf}: bidi overrides, zero-width marks) is removed, so nothing in a
 * mail can move the cursor, retitle the terminal, write the clipboard or reorder what is shown.
 */
const oneLine = (value: unknown): string =>
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  String(value).replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, '')

/** A mail's text or HTML, safe to print: the same, keeping its line breaks and tabs. */
const block = (value: string): string =>
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/gu, '')

/** Stop with `message`, which can quote what a server answered, run through block(). */
function fail(message: string): never {
  console.error(block(message))
  process.exit(1)
}

/** A mail's addresses, safe to print. */
const addresses = (to: string | string[]): string => oneLine([to].flat().join(', '))

/** The value after `--name`, and the arguments without the two. */
function option(args: string[], name: string): { value?: string; rest: string[] } {
  const at = args.indexOf(`--${name}`)
  if (at === -1) return { rest: args }
  return { value: args[at + 1], rest: [...args.slice(0, at), ...args.slice(at + 2)] }
}

function printState(state: WeekState): void {
  console.info(state.email)
  if (state.dayZero === null) {
    console.info('  day 0: none yet, until the link in the confirm mail is opened')
  } else {
    console.info(`  day 0: ${state.dayZero} UTC, now day ${String(state.day)}`)
  }
  console.info(`  Settings switch: ${state.settingsSwitch ? 'shown' : 'hidden'}`)
  console.info(`  day-2 mail: ${state.mails.day2}`)
  console.info(`  day-7 mail: ${state.mails.day7}`)
}

function listening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      done(true)
    })
    socket.once('error', () => {
      done(false)
    })
  })
}

async function waitUntilUp(name: string, url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if ((await httpGet(url, 5_000)).status < 500) return
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`${name} did not come up at ${url}`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

/**
 * The mailbox, the Worker and the app, each in a process group of its own, until a signal or
 * until one of them stops. Then every group gets SIGTERM, and SIGKILL if it is still there after
 * ten seconds. Nothing is stopped by name.
 */
async function up(): Promise<void> {
  for (const port of [APP_PORT, API_PORT, MAIL_PORT]) {
    if (await listening(port)) {
      fail(
        `:${String(port)} is taken. Pick free ports with E2E_PORT, E2E_API_PORT and E2E_MAIL_PORT.`
      )
    }
  }
  const persist = env.WRANGLER_PERSIST_TO
  const wrangler = resolve(WORKER, 'node_modules', '.bin', 'wrangler')
  const migrated = spawnSync(
    wrangler,
    [
      'd1',
      'migrations',
      'apply',
      'finance-manager',
      '--local',
      ...(persist ? ['--persist-to', persist] : []),
    ],
    { cwd: WORKER, stdio: 'inherit' }
  )
  if (migrated.status !== 0) fail('The local D1 migrations did not apply.')

  const mailDir = env.E2E_MAILBOX_DIR || resolve(FRONTEND, 'test-results', 'time-machine-mailbox')
  // The origins the mails link to: the app and Worker on 127.0.0.1, where the browser that signed
  // up keeps its cookies, so a confirm link opened there signs it in.
  const workerVars = {
    CORS_ORIGIN: APP,
    API_PUBLIC_ORIGIN: API,
    DEV_MAIL_SINK: `${MAILBOX}/emails`,
  }
  const children: ChildProcess[] = []
  const start = (command: string, args: string[], extra: Record<string, string>) => {
    const child = spawn(command, args, {
      cwd: FRONTEND,
      stdio: 'inherit',
      detached: true,
      env: { ...env, ...extra },
    })
    children.push(child)
    return child
  }
  let stopping = false
  const stop = async (code: number) => {
    if (stopping) return
    stopping = true
    const alive = children.filter((c) => c.exitCode === null && c.signalCode === null)
    const exited = alive.map((c) => new Promise((r) => c.once('exit', r)))
    for (const c of alive) if (c.pid) process.kill(-c.pid, 'SIGTERM')
    const timer = setTimeout(() => {
      for (const c of alive) {
        if (c.pid && c.exitCode === null && c.signalCode === null) process.kill(-c.pid, 'SIGKILL')
      }
    }, 10_000)
    await Promise.all(exited)
    clearTimeout(timer)
    process.exit(code)
  }
  process.on('SIGINT', () => void stop(0))
  process.on('SIGTERM', () => void stop(0))

  start(
    process.execPath,
    ['scripts/mailbox.mjs', '--port', String(MAIL_PORT), '--dir', mailDir],
    {}
  )
  start(process.execPath, ['scripts/serve-worker.mjs'], {
    E2E_API_PORT: String(API_PORT),
    WORKER_VARS: JSON.stringify(workerVars),
  })
  start(
    resolve(FRONTEND, 'node_modules', '.bin', 'vite'),
    ['--port', String(APP_PORT), '--strictPort'],
    {
      API_PROXY_TARGET: API,
    }
  )
  for (const child of children) {
    child.once('exit', (code) => {
      if (!stopping) {
        console.error(
          `[time-machine] a server stopped (exit ${String(code)}), so the rest stop too`
        )
        void stop(1)
      }
    })
  }
  try {
    await waitUntilUp('The mailbox', `${MAILBOX}/health`, 30_000)
    await waitUntilUp('The Worker', `${API}/api/health`, 120_000)
    await waitUntilUp('The app', `${APP}/`, 120_000)
  } catch (e) {
    console.error(`[time-machine] ${(e as Error).message}`)
    await stop(1)
  }
  console.info(`
[time-machine] up. Ctrl+C stops all three.
  app      ${APP}/
  Worker   ${API}/
  mailbox  ${MAILBOX}/   (mails also kept in ${mailDir})`)
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv
  switch (command) {
    case 'up':
      return up()
    case 'day': {
      const { value: at, rest } = option(args, 'at')
      const [email, n] = rest
      if (!email || n === undefined || Number.isNaN(Number(n))) fail(USAGE)
      const { moved, state } = machine.moveTo(email, Number(n), at)
      const hours = (moved / 3600).toFixed(2)
      console.info(moved > 0 ? `Moved ${hours} hours back.` : 'Already there: nothing moved.')
      printState(state)
      return
    }
    case 'fire': {
      const before = await machine.mails()
      await machine.fire()
      const seen = new Set(before.map((m) => m.id))
      const sent = (await machine.mails()).filter((m) => !seen.has(m.id))
      console.info(
        sent.length ? `The daily job sent ${String(sent.length)}:` : 'The daily job sent nothing.'
      )
      for (const m of sent) {
        console.info(`  ${oneLine(m.id)}  ${addresses(m.to)}  ${oneLine(m.subject)}`)
      }
      return
    }
    case 'state': {
      const [email] = args.filter((a) => a !== '--json')
      if (!email) fail(USAGE)
      const state = machine.state(email)
      if (args.includes('--json')) console.info(JSON.stringify(state, null, 2))
      else printState(state)
      return
    }
    case 'mails': {
      for (const m of await machine.mails(args[0])) {
        console.info(`${oneLine(m.id)}  ${addresses(m.to)}  ${oneLine(m.subject)}`)
      }
      return
    }
    case 'mail': {
      const [id] = args.filter((a) => a !== '--html')
      if (!id) fail(USAGE)
      const mail = await machine.mail(id)
      if (args.includes('--html')) {
        console.info(block(mail.html))
        return
      }
      console.info(
        `${oneLine(mail.subject)}\n  to ${addresses(mail.to)}, ${oneLine(mail.received_at)}`
      )
      console.info('Links:')
      for (const link of machine.links(mail)) console.info(`  ${oneLine(link)}`)
      console.info(`\n${mail.text === undefined ? '(no plain text)' : block(mail.text)}`)
      return
    }
    default:
      fail(USAGE)
  }
}

await main(process.argv.slice(2)).catch((e: unknown) => {
  fail((e as Error).message)
})
