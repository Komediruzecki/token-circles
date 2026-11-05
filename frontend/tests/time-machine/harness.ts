/**
 * The time machine: a new account's first week, lived in minutes on a local stack. One harness
 * for the E2E journey spec (tests/first-week-journey.spec.ts) and for the command a person or an
 * agent drives by hand (cli.ts), so the two cannot drift apart. It needs nothing from Playwright.
 *
 * - `moveTo` puts an account on day N of its first week.
 * - `fire` runs the daily job, the Worker's own scheduled handler on its 08:30 cron.
 * - `mails`, `mail`, `waitForMail` and `links` read what the Worker sent, from the local mailbox
 *   (scripts/mailbox.mjs) that its mails go to instead of Resend.
 * - `state` says where the account is in its week and what the next daily job would do.
 *
 * The frame is data back (worker/scripts/time-machine.ts): "day N" moves the account's own instants
 * into the past, and every clock stays the real one. So `fire` takes no day and always runs the job
 * at the real now. A job fired at a moved time on top of a moved account would count the days
 * twice. Local-first has no server and no account to move; its first week runs on Playwright's
 * page.clock instead (the journey spec shows how), and never on both.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import { resolve } from 'node:path'
import {
  ageSeconds,
  DAILY_CRON,
  describeWeek,
  moveBy,
  moveStatements,
  targetSeconds,
  weekRowSql,
} from '../../../worker/scripts/time-machine.ts'
import type { WeekRow, WeekState } from '../../../worker/scripts/time-machine.ts'

/** A mail as the mailbox lists it. */
export interface MailSummary {
  id: string
  received_at: string
  from: string | null
  to: string | string[]
  subject: string
}

/** A mail as the Worker sent it: Resend's request body, with the mailbox's id. */
export interface Mail extends MailSummary {
  html: string
  text?: string
  headers?: Record<string, string>
  reply_to?: string | string[]
}

export interface MachineOptions {
  /** The local Worker, such as http://127.0.0.1:8827. */
  apiBase: string
  /** The local mailbox, such as http://127.0.0.1:8837. */
  mailBase: string
  /** worker/, where wrangler and its local D1 live. Found from the working directory if unset. */
  workerDir?: string
  /** The Worker's --persist-to, when it has one. Defaults to WRANGLER_PERSIST_TO. */
  persistTo?: string
  /** The clock. Always the real one, except in this harness's own unit test. */
  now?: () => number
}

/** A mail's id as the mailbox makes them, so a path built from one cannot point elsewhere. */
const MAIL_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}$/

const sleep = (ms: number) =>
  new Promise<void>((done) => {
    setTimeout(done, ms)
  })
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * One GET over node:http, which runs the same under Playwright, plain Node and jsdom. A connection
 * of its own each time: a kept-alive one can be closed by the server the moment it is reused, and
 * the request then fails with a socket hang up.
 */
export function httpGet(
  url: string,
  timeoutMs = 60_000
): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request(url, { method: 'GET', timeout: timeoutMs, agent: false }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        body += chunk
      })
      res.on('end', () => {
        done({ status: res.statusCode ?? 0, body })
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error(`no answer from ${url} in ${String(timeoutMs)} ms`))
    })
    req.on('error', fail)
    req.end()
  })
}

function findWorkerDir(): string {
  for (const dir of [resolve(process.cwd(), 'worker'), resolve(process.cwd(), '..', 'worker')]) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- derived from cwd, not input
    if (existsSync(resolve(dir, 'wrangler.jsonc'))) return dir
  }
  throw new Error(`worker/ not found from ${process.cwd()}: run from the repo root or frontend/`)
}

/** Every link in a mail's HTML, in order, each once. */
export function linksOf(mail: Pick<Mail, 'html'>): string[] {
  const found = [...mail.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll('&amp;', '&'))
  return [...new Set(found)]
}

export function timeMachine(options: MachineOptions) {
  const workerDir = options.workerDir ?? findWorkerDir()
  const persistTo = options.persistTo ?? process.env.WRANGLER_PERSIST_TO
  const now = options.now ?? Date.now
  const wrangler = resolve(workerDir, 'node_modules', '.bin', 'wrangler')

  /**
   * One `wrangler d1 execute --local` against the D1 the Worker serves from. The Worker holds the
   * same file, so a statement can land on SQLITE_BUSY: retried, as tests/db.ts does.
   */
  function d1(command: string): { results: unknown[] }[] {
    const args = ['d1', 'execute', 'finance-manager', '--local', '--json', '--command', command]
    if (persistTo) args.push('--persist-to', persistTo)
    let last: unknown
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const out = execFileSync(wrangler, args, {
          cwd: workerDir,
          stdio: 'pipe',
          maxBuffer: 64 * 1024 * 1024,
        }).toString()
        return JSON.parse(out) as { results: unknown[] }[]
      } catch (err) {
        last = err
        const e = err as { stderr?: Buffer; stdout?: Buffer }
        const text = `${String(e.stderr ?? '')}${String(e.stdout ?? '')}`
        if (!text.includes('SQLITE_BUSY') && !text.includes('database is locked')) throw err
        sleepSync(250 * (attempt + 1))
      }
    }
    throw last
  }

  const rows = <T>(sql: string): T[] => (d1(sql)[0]?.results ?? []) as T[]

  /** The account at `email` and its first week, or null when there is none. */
  const account = (email: string): WeekRow | null => rows<WeekRow>(weekRowSql(email))[0] ?? null

  function state(email: string): WeekState {
    const row = account(email)
    if (!row) throw new Error(`no account at ${email}`)
    return describeWeek(row, now())
  }

  /**
   * Put the account at `email` on day `day` of its first week (`at` 'HH:MM' UTC for a time of
   * day), moving it forward only. Worked out from day 0 as stored, and sent as one batch that
   * checks day 0 is still that, so asking twice lands once. Reload the app's pages after a move:
   * a page keeps what it read.
   */
  function moveTo(email: string, day: number, at?: string): { moved: number; state: WeekState } {
    const row = account(email)
    if (!row) throw new Error(`no account at ${email}`)
    if (!row.day_zero) {
      throw new Error(`${email} has no day 0 yet: its address is confirmed by the link in its mail`)
    }
    const moved = moveBy(ageSeconds(row.day_zero, now()), targetSeconds(row.day_zero, day, at))
    if (moved > 0) d1(moveStatements(row.id, moved, row.day_zero).join(';\n'))
    return { moved, state: state(email) }
  }

  /**
   * Run the daily job once, at the real now, through wrangler's own endpoint for a scheduled
   * event. It answers once the job is done, so every mail it sent is in the mailbox by then.
   */
  async function fire(): Promise<void> {
    const query = new URLSearchParams({ cron: DAILY_CRON, time: String(now()) })
    const url = `${options.apiBase}/cdn-cgi/handler/scheduled?${query.toString()}`
    const res = await httpGet(url, 120_000)
    if (res.status !== 200) {
      throw new Error(`the daily job answered ${String(res.status)}: ${res.body.slice(0, 200)}`)
    }
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await httpGet(`${options.mailBase}${path}`)
    if (res.status !== 200) {
      throw new Error(`the mailbox answered ${String(res.status)} to ${path}`)
    }
    return JSON.parse(res.body) as T
  }

  /** The mails, oldest first; to `to` only when given. */
  const mails = (to?: string) =>
    getJson<MailSummary[]>(`/mails${to ? `?${new URLSearchParams({ to }).toString()}` : ''}`)

  function mail(id: string): Promise<Mail> {
    if (!MAIL_ID.test(id)) throw new Error(`not a mail id: ${id}`)
    return getJson<Mail>(`/mails/${id}`)
  }

  /** The mails to `to` that came after the mail `after` (an id), or all of them. */
  async function mailsSince(to: string, after?: string): Promise<MailSummary[]> {
    return (await mails(to)).filter((m) => after === undefined || m.id > after)
  }

  /**
   * The first mail to `to` with `subject` that came after the mail `after`, once it is there.
   * Throws when none came in `timeoutMs`.
   */
  async function waitForMail(
    to: string,
    subject: string | RegExp,
    { after, timeoutMs = 15_000 }: { after?: string; timeoutMs?: number } = {}
  ): Promise<Mail> {
    const deadline = Date.now() + timeoutMs
    const matches = (s: string) => (typeof subject === 'string' ? s === subject : subject.test(s))
    for (;;) {
      const found = (await mailsSince(to, after)).find((m) => matches(m.subject))
      if (found) return mail(found.id)
      if (Date.now() > deadline) {
        throw new Error(`no mail "${String(subject)}" to ${to} in ${String(timeoutMs)} ms`)
      }
      await sleep(250)
    }
  }

  /** The id of the newest mail to `to`, to wait for or rule out what comes after it. */
  async function lastMailId(to: string): Promise<string | undefined> {
    return (await mails(to)).at(-1)?.id
  }

  return {
    rows,
    account,
    state,
    moveTo,
    fire,
    mails,
    mail,
    mailsSince,
    waitForMail,
    lastMailId,
    links: linksOf,
  }
}

export type Machine = ReturnType<typeof timeMachine>
