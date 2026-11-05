/**
 * The time machine's command (tests/time-machine/cli.ts), run as a person runs it: under plain
 * Node, which strips its types. `up` starts three servers on ports of its own choosing through the
 * same variables the E2E suite reads, so it first makes sure nothing holds them: a server already
 * there is someone else's, and `up` would otherwise run its Worker beside it or adopt it.
 *
 * node:http and node:net rather than fetch, as in mailbox.test.ts: this suite runs under jsdom.
 */
import { spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:net'

const CLI = resolve(__dirname, '../../tests/time-machine/cli.ts')
const FRONTEND = resolve(__dirname, '../..')
const held: Server[] = []

afterEach(async () => {
  for (const s of held.splice(0)) {
    await new Promise<void>((done) => {
      s.close(() => {
        done()
      })
    })
  }
})

/** A port this test listens on, as someone else's server would. */
function hold(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer()
    held.push(server)
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      done((server.address() as { port: number }).port)
    })
  })
}

/** Run the command with `args` and these ports, and collect what it said and how it ended. */
function run(
  args: string[],
  ports: { app: number; api: number; mail: number }
): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: FRONTEND,
      env: {
        ...process.env,
        E2E_PORT: String(ports.app),
        E2E_API_PORT: String(ports.api),
        E2E_MAIL_PORT: String(ports.mail),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (b: Buffer) => (out += String(b)))
    child.stderr.on('data', (b: Buffer) => (out += String(b)))
    child.on('exit', (code) => {
      done({ code, out })
    })
  })
}

describe('the time machine command', () => {
  it('starts nothing when a port it needs is taken', async () => {
    const app = await hold()
    const result = await run(['up'], { app, api: await hold(), mail: await hold() })
    expect(result.code).toBe(1)
    expect(result.out).toContain(`:${String(app)} is taken`)
    expect(result.out).not.toContain('wrangler')
  })

  it("prints a mail's fields with every control and format character taken out", async () => {
    // A mailbox of this test's own whose one mail carries terminal control sequences: a clipboard
    // write (OSC 52), a title change, a line erase and a C1 CSI, then Unicode format characters
    // (a right-to-left override, a zero-width space, an isolate), in every field the command prints.
    const esc =
      '\u001b]52;c;cHduZWQ=\u0007\u001b]0;TITLE\u0007\u001b[2K\r\u009b2J\u202e\u200b\u2066'
    const id = '2026-11-03T08-30-00-000Z-0123abcd'
    const kept = {
      id,
      received_at: `2026-11-03T08:30:00.000Z${esc}`,
      from: 'Token Circles <hello@tokencircles.com>',
      to: [`reader${esc}@example.test`],
      subject: `Reset${esc} your password`,
      html: `<p>Hi${esc}</p>\n<a href="http://127.0.0.1:3840/reset${esc}">Reset</a>`,
      text: `Line one${esc}\n\tLine two`,
    }
    const mailbox = createHttpServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/mails') res.end(JSON.stringify([{ ...kept, id: `${id}${esc}` }]))
      else if (req.url === `/mails/${id}`) res.end(JSON.stringify(kept))
      else res.writeHead(404).end('{}')
    })
    await new Promise<void>((done) => mailbox.listen(0, '127.0.0.1', done))
    const mail = (mailbox.address() as { port: number }).port
    try {
      const ports = { app: 1, api: 2, mail }
      // eslint-disable-next-line no-control-regex -- the characters this test looks for
      const control = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/u
      const listed = await run(['mails'], ports)
      expect(listed.code).toBe(0)
      expect(listed.out).toContain('Reset]52;c;cHduZWQ=]0;TITLE[2K2J your password')
      expect(listed.out).toContain(id)
      const one = await run(['mail', id], ports)
      expect(one.code).toBe(0)
      expect(one.out).toContain('Line one')
      expect(one.out).toContain('\n\tLine two')
      expect(one.out).toContain('http://127.0.0.1:3840/reset')
      const html = await run(['mail', id, '--html'], ports)
      expect(html.out).toContain('<p>Hi]52;')
      for (const { out } of [listed, one, html]) expect(out).not.toMatch(control)
    } finally {
      await new Promise<void>((done) => {
        mailbox.close(() => {
          done()
        })
      })
    }
  })

  it('stops with what a server answered, its control and format characters taken out', async () => {
    // A mailbox whose answer is not JSON: the error quotes it.
    const mailbox = createHttpServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end('\u001b]0;TITLE\u0007\u001b[2K\r\u202enot json')
    })
    await new Promise<void>((done) => mailbox.listen(0, '127.0.0.1', done))
    const mail = (mailbox.address() as { port: number }).port
    try {
      const result = await run(['mails'], { app: 1, api: 2, mail })
      expect(result.code).toBe(1)
      expect(result.out).toContain('is not valid JSON')
      expect(result.out).toContain('"]0;TITLE')
      // eslint-disable-next-line no-control-regex -- the characters this test looks for
      expect(result.out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/u)
    } finally {
      await new Promise<void>((done) => {
        mailbox.close(() => {
          done()
        })
      })
    }
  })

  it('says how it is used when the command is not one of its own', async () => {
    const result = await run(['travel'], { app: 1, api: 2, mail: 3 })
    expect(result.code).toBe(1)
    expect(result.out).toContain('Usage, from frontend/:')
    expect(result.out).toContain('pnpm run time-machine day <email> <N> [--at HH:MM]')
  })
})
