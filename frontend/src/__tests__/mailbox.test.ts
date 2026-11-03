/**
 * The local mailbox (scripts/mailbox.mjs) that a development Worker's mails go to, run the way
 * playwright.config.ts and the time machine run it: as its own process, on a port of its own.
 *
 * It takes a mail as the Worker posts one (JSON by its exact type, neither header a browser adds
 * when a page posts) and keeps its fields under an id and arrival time of its own making, in memory
 * and as files a person can open. It answers only on 127.0.0.1 and only to requests addressed to
 * this machine, never names a file after anything in a mail, never prints a mail's body or links,
 * shows a mail's HTML with nothing in it able to run, and keeps a bounded number of mails.
 *
 * node:http and node:net rather than fetch, as in e2eWorkerTeardown.test.ts: this suite runs under
 * jsdom, whose AbortSignal Node's fetch rejects.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is this test's own mkdtemp */
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { indexPage } from '../../scripts/lib/mailbox.mjs'
import type { ChildProcess } from 'node:child_process'
import type { Dirent } from 'node:fs'
import type { AddressInfo } from 'node:net'

const SCRIPT = resolve(__dirname, '../../scripts/mailbox.mjs')
const MAIL_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}$/

interface Box {
  child: ChildProcess
  port: number
  dir: string
  output: () => string
}

const running: Box[] = []
const dirs: string[] = []

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
 * A folder for the mailbox, two levels inside a folder of this test's own (which it removes
 * after): <root>/box/mails, so a path two levels up from it is still the test's.
 */
function newDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'mailbox-test-'))
  dirs.push(root)
  return join(root, 'box', 'mails')
}

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
    .sort()
}

/** Start the mailbox on a free port, keeping its files in `dir`; resolves once it listens. */
async function start(dir = newDir(), extra: string[] = []): Promise<Box> {
  const port = await freePort()
  const child = spawn(process.execPath, [SCRIPT, '--port', String(port), '--dir', dir, ...extra], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (b: Buffer) => (out += String(b)))
  child.stderr.on('data', (b: Buffer) => (out += String(b)))
  const box = { child, port, dir, output: () => out }
  running.push(box)
  for (let i = 0; i < 100 && !out.includes('listening on'); i++) {
    await new Promise((r) => setTimeout(r, 50))
  }
  expect(out, 'the mailbox said where it listens').toContain(
    `listening on http://127.0.0.1:${port}`
  )
  return box
}

async function stop(box: Box): Promise<void> {
  if (box.child.exitCode !== null || box.child.signalCode !== null) return
  const exited = new Promise((r) => box.child.once('exit', r))
  box.child.kill('SIGTERM')
  await exited
}

afterEach(async () => {
  for (const box of running.splice(0)) await stop(box)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Answer {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/**
 * One request to the mailbox, with the Host header a client on this machine sends by default and,
 * with a body, the one header the Worker sends (Content-Type: application/json). `headers` adds to
 * or replaces those; a header set to null is left out.
 */
function call(
  box: Box,
  method: string,
  path: string,
  body?: string,
  host = `127.0.0.1:${box.port}`,
  headers: Record<string, string | null> = {}
): Promise<Answer> {
  const sent: Record<string, string> = { Host: host }
  if (body !== undefined) sent['Content-Type'] = 'application/json'
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) delete sent[name]
    else sent[name] = value
  }
  return new Promise((res, rej) => {
    const req = request(
      { host: '127.0.0.1', port: box.port, method, path, headers: sent },
      (response) => {
        let text = ''
        response.on('data', (chunk: Buffer) => (text += String(chunk)))
        response.on('end', () => {
          res({ status: response.statusCode ?? 0, headers: response.headers, body: text })
        })
      }
    )
    req.on('error', rej)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** A mail as the Worker posts one (worker/src/email.ts): Resend's body. */
const mail = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    from: 'Token Circles <hello@tokencircles.com>',
    to: 'reader@example.test',
    subject: 'Confirm your email',
    html: '<p>Open <a href="http://127.0.0.1:8827/api/auth/verify-email?token=secret-token-1">this link</a></p>',
    text: 'Open http://127.0.0.1:8827/api/auth/verify-email?token=secret-token-1',
    headers: {
      'List-Unsubscribe': '<http://localhost:8787/api/notifications/unsubscribe?token=u>',
    },
    ...overrides,
  })

describe('the mailbox', () => {
  it('takes a mail as Resend does, keeps it under an id of its own, and serves it back', async () => {
    const box = await start()
    const taken = await call(box, 'POST', '/emails', mail())
    expect(taken.status).toBe(200)
    const { id } = JSON.parse(taken.body) as { id: string }
    expect(id).toMatch(MAIL_ID)

    // As files a person can open, named by the id alone.
    expect(readdirSync(box.dir).sort()).toEqual([`${id}.html`, `${id}.json`, `${id}.txt`])
    const kept = JSON.parse(readFileSync(join(box.dir, `${id}.json`), 'utf8')) as Record<
      string,
      unknown
    >
    expect(kept).toMatchObject({ id, to: 'reader@example.test', subject: 'Confirm your email' })
    expect(readFileSync(join(box.dir, `${id}.txt`), 'utf8')).toContain('secret-token-1')

    // Listed by address, without the bodies; then whole.
    const listed = await call(box, 'GET', '/mails?to=READER@example.test')
    expect(JSON.parse(listed.body)).toEqual([
      expect.objectContaining({ id, to: 'reader@example.test', subject: 'Confirm your email' }),
    ])
    expect(listed.body).not.toContain('secret-token-1')
    expect(
      JSON.parse((await call(box, 'GET', '/mails?to=someone-else@example.test')).body)
    ).toEqual([])
    const whole = JSON.parse((await call(box, 'GET', `/mails/${id}`)).body) as { html: string }
    expect(whole.html).toContain('secret-token-1')

    // The HTML as a mail app shows it, with nothing in it able to run, and the text.
    const html = await call(box, 'GET', `/mails/${id}.html`)
    expect(html.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(html.headers['content-security-policy']).toContain("default-src 'none'")
    expect(html.headers['content-security-policy']).not.toContain('script-src')
    // Sandboxed: no meta refresh, no script, no form, even one the policy's other parts allow.
    expect(html.headers['content-security-policy']).toMatch(/(^|; )sandbox(;|$)/)
    expect(html.body).toContain('this link')
    expect((await call(box, 'GET', `/mails/${id}.txt`)).body).toContain('secret-token-1')
  })

  it('never names a file after anything in the mail', async () => {
    const box = await start()
    const taken = await call(
      box,
      'POST',
      '/emails',
      mail({ to: '../../escape@example.test', subject: '../../../escape' })
    )
    const { id } = JSON.parse(taken.body) as { id: string }
    expect(readdirSync(box.dir).sort()).toEqual([`${id}.html`, `${id}.json`, `${id}.txt`])
    expect(readdirSync(join(box.dir, '..'))).toEqual(['mails'])
    // An id is the only thing a path can name.
    expect((await call(box, 'GET', '/mails/..%2f..%2fetc%2fpasswd')).status).toBe(404)
    expect((await call(box, 'GET', `/mails/${id}.json`)).status).toBe(404)
  })

  it('keeps its own id and arrival time, and only the fields of a mail', async () => {
    const box = await start()
    const root = join(box.dir, '..', '..')
    const taken = await call(
      box,
      'POST',
      '/emails',
      mail({ id: '../../x', received_at: '1999-01-01T00:00:00.000Z', extra: 'not kept' })
    )
    expect(taken.status).toBe(200)
    const { id } = JSON.parse(taken.body) as { id: string }
    expect(id).toMatch(MAIL_ID)

    // Its three files, under its own id, and nothing anywhere else in the test's folder.
    expect(filesUnder(root)).toEqual(
      [`${id}.html`, `${id}.json`, `${id}.txt`].map((f) => join('box', 'mails', f))
    )
    const kept = JSON.parse(readFileSync(join(box.dir, `${id}.json`), 'utf8')) as Record<
      string,
      unknown
    >
    expect(Object.keys(kept).sort()).toEqual(
      ['from', 'headers', 'html', 'id', 'received_at', 'subject', 'text', 'to'].sort()
    )
    expect(kept.id).toBe(id)
    expect(kept.received_at).not.toBe('1999-01-01T00:00:00.000Z')
    expect(Date.now() - Date.parse(String(kept.received_at))).toBeLessThan(60_000)
    expect(JSON.parse((await call(box, 'GET', '/mails')).body)).toEqual([
      expect.objectContaining({ id, received_at: kept.received_at }),
    ])
  })

  it('takes a mail only as the Worker posts one', async () => {
    const box = await start()
    // The request the Worker makes: JSON by its exact type, and a header of Cloudflare's own.
    const worker = await call(box, 'POST', '/emails', mail(), undefined, { 'cf-worker': 'dev' })
    expect(worker.status).toBe(200)

    // A web form can send text/plain whose body happens to parse as JSON.
    const form = await call(box, 'POST', '/emails', mail(), undefined, {
      'Content-Type': 'text/plain',
    })
    expect(form.status).toBe(415)
    for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=b']) {
      expect(
        (await call(box, 'POST', '/emails', mail(), undefined, { 'Content-Type': type })).status,
        type
      ).toBe(415)
    }
    expect(
      (await call(box, 'POST', '/emails', mail(), undefined, { 'Content-Type': null })).status
    ).toBe(415)

    // A browser marks a page's post with one of these, whatever its type.
    for (const header of <Record<string, string>[]>[
      { Origin: 'http://127.0.0.1:3840' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'same-site' },
      { 'Sec-Fetch-Site': 'none' },
    ]) {
      const answer = await call(box, 'POST', '/emails', mail(), undefined, header)
      expect(answer.status, JSON.stringify(header)).toBe(403)
    }

    // Only the Worker's mail was kept.
    const { id } = JSON.parse(worker.body) as { id: string }
    expect(
      (JSON.parse((await call(box, 'GET', '/mails')).body) as { id: string }[]).map((m) => m.id)
    ).toEqual([id])
    expect(readdirSync(box.dir).sort()).toEqual([`${id}.html`, `${id}.json`, `${id}.txt`])
  })

  it('keeps at most --max-mails mails, dropping the oldest and its files', async () => {
    const box = await start(undefined, ['--max-mails', '3'])
    writeFileSync(join(box.dir, 'notes.txt'), 'a person left this here')
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const taken = await call(box, 'POST', '/emails', mail({ subject: `Mail ${String(i)}` }))
      ids.push((JSON.parse(taken.body) as { id: string }).id)
    }
    const kept = ids.slice(2)
    expect(
      (JSON.parse((await call(box, 'GET', '/mails')).body) as { id: string }[]).map((m) => m.id)
    ).toEqual(kept)
    expect(readdirSync(box.dir).sort()).toEqual(
      [...kept.flatMap((id) => [`${id}.html`, `${id}.json`, `${id}.txt`]), 'notes.txt'].sort()
    )
    expect(JSON.parse((await call(box, 'GET', '/health')).body)).toEqual({ ok: true, mails: 3 })
  })

  it('keeps at most --max-bytes of mail, dropping the oldest', async () => {
    // Each of these mails is a little over 2000 bytes as JSON, so two fit under 5000.
    const box = await start(undefined, ['--max-bytes', '5000'])
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const taken = await call(box, 'POST', '/emails', mail({ html: 'x'.repeat(1800) }))
      ids.push((JSON.parse(taken.body) as { id: string }).id)
    }
    expect(
      (JSON.parse((await call(box, 'GET', '/mails')).body) as { id: string }[]).map((m) => m.id)
    ).toEqual(ids.slice(2))
    expect(readdirSync(box.dir)).toHaveLength(6)
  })

  it('trims a folder that holds more mails than it keeps when it starts', async () => {
    const dir = newDir()
    const first = await start(dir)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      ids.push(
        (JSON.parse((await call(first, 'POST', '/emails', mail())).body) as { id: string }).id
      )
    }
    await stop(first)
    const second = await start(dir, ['--max-mails', '1'])
    // A folder is read back in id order; two mails in one millisecond order by their random part.
    expect(
      (JSON.parse((await call(second, 'GET', '/mails')).body) as { id: string }[]).map((m) => m.id)
    ).toEqual([ids.sort().at(-1)])
    expect(readdirSync(dir)).toHaveLength(3)
  })

  it('never prints a mail, its subject or its links', async () => {
    const box = await start()
    await call(box, 'POST', '/emails', mail({ subject: 'Subject-line-7731' }))
    await call(box, 'GET', '/')
    expect(box.output()).not.toContain('secret-token-1')
    expect(box.output()).not.toContain('Subject-line-7731')
    expect(box.output()).not.toContain('verify-email')
  })

  it('takes only mails', async () => {
    const box = await start()
    expect((await call(box, 'POST', '/emails', 'not json')).status).toBe(400)
    for (const broken of [
      '[]',
      '{}',
      JSON.stringify({ to: 'a@example.test', subject: 'No html' }),
      JSON.stringify({ to: 7, subject: 's', html: 'h' }),
      JSON.stringify({ to: 'a@example.test', subject: 's', html: 'h', headers: { X: 1 } }),
    ]) {
      expect((await call(box, 'POST', '/emails', broken)).status, broken).toBe(422)
    }
    const huge = mail({ html: 'x'.repeat(3 * 1024 * 1024) })
    expect((await call(box, 'POST', '/emails', huge)).status).toBe(413)
    expect(JSON.parse((await call(box, 'GET', '/mails')).body)).toEqual([])
    expect(readdirSync(box.dir)).toEqual([])
  })

  it('answers only requests addressed to this machine', async () => {
    const box = await start()
    await call(box, 'POST', '/emails', mail())
    // A page on a rebound DNS name reaches this port with its own name as the host.
    const rebound = await call(box, 'GET', '/mails', undefined, `evil.test:${box.port}`)
    expect(rebound.status).toBe(403)
    expect(rebound.body).not.toContain('reader@example.test')
    expect((await call(box, 'GET', '/mails', undefined, `localhost:${box.port}`)).status).toBe(200)
  })

  it('listens on 127.0.0.1 only', async () => {
    const box = await start()
    const reached = await new Promise<boolean>((res) => {
      const sock = connect({ host: '::1', port: box.port })
      sock.once('connect', () => {
        sock.destroy()
        res(true)
      })
      sock.once('error', () => {
        res(false)
      })
    })
    expect(reached).toBe(false)
  })

  it("keeps a mail's HTML file behind a policy of its own, after any doctype", async () => {
    const box = await start()
    const policy =
      /^<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*">\n/
    const plain = JSON.parse((await call(box, 'POST', '/emails', mail())).body) as { id: string }
    const file = readFileSync(join(box.dir, `${plain.id}.html`), 'utf8')
    expect(file).toMatch(policy)
    expect(file).toContain("form-action 'none'")
    expect(file).toContain('this link')

    const html = '<!DOCTYPE html>\n<html><body><p>Hi</p></body></html>'
    const full = JSON.parse((await call(box, 'POST', '/emails', mail({ html }))).body) as {
      id: string
    }
    const fullFile = readFileSync(join(box.dir, `${full.id}.html`), 'utf8')
    expect(fullFile.startsWith('<!DOCTYPE html>\n<meta http-equiv="Content-Security-Policy"')).toBe(
      true
    )
    expect(fullFile.endsWith('<html><body><p>Hi</p></body></html>')).toBe(true)
    // The page serves the mail as it came; its own header carries the policy.
    expect((await call(box, 'GET', `/mails/${full.id}.html`)).body).toBe(html)
  })

  it('escapes the id in the index page as it escapes everything else', () => {
    const page = indexPage(
      [
        {
          id: '"><b id="x">',
          received_at: '2026-11-03T08:30:00.000Z',
          to: 'reader@example.test',
          subject: 'Hello',
          html: '',
        },
      ],
      null
    )
    expect(page).not.toContain('<b id="x">')
    expect(page).not.toContain('"><b')
    expect(page).toContain('href="/mails/%22%3E%3Cb%20id%3D%22x%22%3E.html"')
  })

  it('lists mails on a page a person can read, with everything in them escaped', async () => {
    const box = await start()
    await call(box, 'POST', '/emails', mail({ subject: '<img src=x onerror=alert(1)>' }))
    const page = await call(box, 'GET', '/')
    expect(page.status).toBe(200)
    expect(page.body).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(page.body).not.toContain('<img src=x')
    expect(page.headers['content-security-policy']).toContain("default-src 'none'")
  })

  it('keeps the mails in its folder from one run to the next', async () => {
    const dir = newDir()
    const first = await start(dir)
    const { id } = JSON.parse((await call(first, 'POST', '/emails', mail())).body) as {
      id: string
    }
    await stop(first)
    const second = await start(dir)
    expect(
      (JSON.parse((await call(second, 'GET', '/mails')).body) as { id: string }[]).map((m) => m.id)
    ).toEqual([id])
  })
})
