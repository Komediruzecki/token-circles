/**
 * The time machine's harness (tests/time-machine/harness.ts), against stand-ins for the Worker and
 * the mailbox. Its frame is data back: a move puts the account's own instants into the past, and
 * the daily job runs at the real now. A job fired at a moved time as well would count the days
 * twice, so the one thing `fire` sends besides the cron is the clock's own now.
 *
 * node:http rather than fetch, as in mailbox.test.ts: this suite runs under jsdom.
 */
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { linksOf, timeMachine } from '../../tests/time-machine/harness'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const WORKER_DIR = resolve(__dirname, '../../../worker')
const servers: Server[] = []

afterEach(async () => {
  for (const s of servers.splice(0)) {
    await new Promise<void>((done) => {
      s.close(() => {
        done()
      })
      s.closeAllConnections()
    })
  }
})

/** A server on a free port that answers `answer` and records each request's URL. */
async function standIn(
  answer: (url: URL) => { status: number; body: string }
): Promise<{ base: string; seen: URL[] }> {
  const seen: URL[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    seen.push(url)
    const { status, body } = answer(url)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(body)
  })
  servers.push(server)
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', () => {
      done()
    })
  })
  return { base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, seen }
}

describe('the time machine harness', () => {
  it("fires the daily job on its cron at the clock's own now, never at a moved time", async () => {
    const worker = await standIn(() => ({ status: 200, body: 'Ran scheduled event' }))
    const clock = 1_800_000_000_000
    const machine = timeMachine({
      apiBase: worker.base,
      mailBase: worker.base,
      workerDir: WORKER_DIR,
      now: () => clock,
    })
    await machine.fire()
    expect(worker.seen).toHaveLength(1)
    const [url] = worker.seen
    expect(url.pathname).toBe('/cdn-cgi/handler/scheduled')
    expect(url.searchParams.get('cron')).toBe('30 8 * * *')
    expect(url.searchParams.get('time')).toBe(String(clock))
    expect([...url.searchParams.keys()].sort()).toEqual(['cron', 'time'])
  })

  it('says so when the daily job fails', async () => {
    const worker = await standIn(() => ({ status: 500, body: 'scheduled handler threw' }))
    const machine = timeMachine({
      apiBase: worker.base,
      mailBase: worker.base,
      workerDir: WORKER_DIR,
    })
    await expect(machine.fire()).rejects.toThrow(/answered 500/)
  })

  it('waits for a mail that came after the one it was given, and reads its links', async () => {
    const list = [
      { id: '2026-11-03T08-00-00-000Z-00000001', to: 'a@example.test', subject: 'Day two' },
      { id: '2026-11-03T08-00-01-000Z-00000002', to: 'a@example.test', subject: 'Day two' },
    ]
    const mailbox = await standIn((url) => {
      if (url.pathname === '/mails') return { status: 200, body: JSON.stringify(list) }
      const id = url.pathname.slice('/mails/'.length)
      const html = `<a href="http://localhost:3840/#import">Import</a> <a href="http://x.test/?a=1&amp;b=${id}">Stop</a> <a href="http://localhost:3840/#import">Again</a>`
      return { status: 200, body: JSON.stringify({ ...list.find((m) => m.id === id), html }) }
    })
    const machine = timeMachine({
      apiBase: mailbox.base,
      mailBase: mailbox.base,
      workerDir: WORKER_DIR,
    })
    const mail = await machine.waitForMail('a@example.test', 'Day two', { after: list[0].id })
    expect(mail.id).toBe(list[1].id)
    expect(linksOf(mail)).toEqual([
      'http://localhost:3840/#import',
      `http://x.test/?a=1&b=${list[1].id}`,
    ])
    expect(mailbox.seen.find((u) => u.pathname === '/mails')?.searchParams.get('to')).toBe(
      'a@example.test'
    )
    await expect(
      machine.waitForMail('a@example.test', 'Day two', { after: list[1].id, timeoutMs: 300 })
    ).rejects.toThrow(/no mail "Day two"/)
    expect(() => machine.mail('../../etc/passwd')).toThrow(/not a mail id/)
  })
})
