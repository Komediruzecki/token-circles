/**
 * The time machine's command (tests/time-machine/cli.ts), run as a person runs it: under plain
 * Node, which strips its types. `up` starts three servers on ports of its own choosing through the
 * same variables the E2E suite reads, so it first makes sure nothing holds them: a server already
 * there is someone else's, and `up` would otherwise run its Worker beside it or adopt it.
 *
 * node:http and node:net rather than fetch, as in mailbox.test.ts: this suite runs under jsdom.
 */
import { spawn } from 'node:child_process'
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

  it('says how it is used when the command is not one of its own', async () => {
    const result = await run(['travel'], { app: 1, api: 2, mail: 3 })
    expect(result.code).toBe(1)
    expect(result.out).toContain('Usage, from frontend/:')
    expect(result.out).toContain('pnpm run time-machine day <email> <N> [--at HH:MM]')
  })
})
