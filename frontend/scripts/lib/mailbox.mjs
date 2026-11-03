// ============================================================
// mailbox — where a local Worker's mails land, so a test or a person can read them.
//
// A Worker run by `wrangler dev` with no RESEND_API_KEY, APP_ENV 'development' and DEV_MAIL_SINK
// set to this server's /emails posts every mail here instead of to Resend (worker/src/email.ts,
// devMailSink). The body is the one Resend would have had: from, to, subject, html, text,
// reply_to, headers. The answer is the one Resend gives, { id }, so the Worker goes on exactly as
// it does once Resend has taken a mail.
//
// Each mail is kept under an id this server makes (never one taken from the mail), in memory for
// the API and on disk for people: <dir>/<id>.json (the body, with the id and when it came),
// <id>.html and <id>.txt.
//
//   POST /emails          take a mail; answers { id }
//   GET  /mails?to=ADDR   the mails, oldest first, without their bodies; `to` filters by address
//   GET  /mails/ID        one mail, all of it
//   GET  /mails/ID.html   its HTML, as a mail app would show it (no scripts run)
//   GET  /mails/ID.txt    its plain text
//   GET  /                a page listing them, for a person
//   GET  /health          { ok, mails }
//
// It listens on 127.0.0.1 only and answers only requests addressed to this machine by name or
// address (the Host header), so a web page cannot read the mails through a rebound DNS name. It
// never prints a mail's body or links: a mail holds sign-in links.
// ============================================================
import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

/** The largest mail this takes. The app's biggest mails are well under 200 KB. */
const MAX_BODY_BYTES = 2 * 1024 * 1024
/** A mail's id: when it came (UTC, to the millisecond) and 8 random hex digits. */
export const MAIL_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}$/

/** Nothing the mail carries can run, fetch a script, post a form or frame this page. */
const MAIL_CSP =
  "default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const newId = () =>
  `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  )

const isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Whether `body` is a mail as Resend takes one: the fields sendMail sends, of their types. */
function isMail(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  if (typeof body.subject !== 'string' || typeof body.html !== 'string') return false
  if (typeof body.to !== 'string' && !isStringList(body.to)) return false
  if (body.from !== undefined && typeof body.from !== 'string') return false
  if (body.text !== undefined && typeof body.text !== 'string') return false
  if (
    body.reply_to !== undefined &&
    typeof body.reply_to !== 'string' &&
    !isStringList(body.reply_to)
  )
    return false
  if (body.headers !== undefined) {
    if (!body.headers || typeof body.headers !== 'object' || Array.isArray(body.headers))
      return false
    if (!Object.values(body.headers).every((v) => typeof v === 'string')) return false
  }
  return true
}

/** The addresses a mail went to, lowercased. */
const recipients = (mail) => [mail.to].flat().map((a) => a.toLowerCase())

/** A mail without its bodies, as the list shows it. */
const summary = (mail) => ({
  id: mail.id,
  received_at: mail.received_at,
  from: mail.from ?? null,
  to: mail.to,
  subject: mail.subject,
})

/** The mails a directory already holds, oldest first. A file that is not one of ours is left be. */
function loadMails(dir) {
  const mails = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || !MAIL_ID.test(name.slice(0, -5))) continue
    try {
      const mail = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (isMail(mail) && mail.id === name.slice(0, -5)) mails.push(mail)
    } catch {
      // Not a mail this server wrote. It stays where it is, unread.
    }
  }
  return mails.sort((a, b) => (a.id < b.id ? -1 : 1))
}

function indexPage(mails, to) {
  const rows = mails
    .slice()
    .reverse()
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.received_at)}</td><td>${escapeHtml([m.to].flat().join(', '))}</td>` +
        `<td>${escapeHtml(m.subject)}</td><td><a href="/mails/${m.id}.html">HTML</a> ` +
        `<a href="/mails/${m.id}.txt">Text</a> <a href="/mails/${m.id}">JSON</a></td></tr>`
    )
    .join('\n')
  const shown = to ? ` to ${escapeHtml(to)}` : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Local mailbox</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:24px 16px;color:#1d2433;background:#fbfaf7}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#5b6475}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e4e0d8;vertical-align:top}
th{font-size:13px;color:#5b6475}a{color:#2d5bd7;margin-right:8px}form{margin:0 0 16px}
input{font:inherit;padding:4px 8px}@media (prefers-color-scheme:dark){body{background:#14171f;color:#e8e6e1}th,p{color:#a4abb8}td,th{border-color:#2a2f3a}a{color:#8fb0ff}}
</style></head><body>
<h1>Local mailbox</h1>
<p>${mails.length} ${mails.length === 1 ? 'mail' : 'mails'}${shown}, newest first. The local Worker sends here instead of Resend.</p>
<form method="get" action="/"><label>To <input name="to" type="email" value="${escapeHtml(to ?? '')}"></label> <button>Show</button></form>
<table><thead><tr><th>Received (UTC)</th><th>To</th><th>Subject</th><th>Open</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="4">No mail yet.</td></tr>'}
</tbody></table></body></html>`
}

/**
 * Start a mailbox on `host`:`port` (0 picks a free port) that keeps its files in `dir`.
 * Resolves once it listens, with its address and a way to stop it.
 *
 * @param {{ port: number, dir: string, host?: string, log?: (msg: string) => void }} opts
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startMailbox({ port, dir, host = '127.0.0.1', log = console.log }) {
  mkdirSync(dir, { recursive: true })
  const mails = loadMails(dir)
  let actualPort = port

  /** Only this machine, by the name or address it listens on. */
  const addressedHere = (req) =>
    [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`].includes(
      String(req.headers.host ?? '').toLowerCase()
    )

  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extra,
    })
    res.end(body)
  }
  const json = (res, status, value) =>
    send(res, status, 'application/json; charset=utf-8', JSON.stringify(value))

  const take = (req, res) => {
    let size = 0
    const chunks = []
    let refused = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES && !refused) {
        // Refused, and the rest is read and dropped, so the sender gets the answer, not a reset.
        refused = true
        chunks.length = 0
        res.setHeader('Connection', 'close')
        json(res, 413, { error: 'Too large' })
      }
      if (!refused) chunks.push(chunk)
    })
    req.on('end', () => {
      if (refused) return
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return json(res, 400, { error: 'Not JSON' })
      }
      if (!isMail(body)) return json(res, 422, { error: 'Not a mail' })
      const mail = { id: newId(), received_at: new Date().toISOString(), ...body }
      // The files are a copy for people. The API reads memory, so a file removed by hand, or a
      // test-results folder Playwright clears at the start of a run, loses no mail mid-run.
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${mail.id}.json`), `${JSON.stringify(mail, null, 2)}\n`)
        writeFileSync(join(dir, `${mail.id}.html`), mail.html)
        writeFileSync(join(dir, `${mail.id}.txt`), mail.text ?? '')
      } catch (e) {
        log(`[mailbox] could not write ${mail.id} to ${dir}: ${e.message}`)
      }
      mails.push(mail)
      log(`[mailbox] took ${mail.id}`)
      json(res, 200, { id: mail.id })
    })
  }

  const server = createServer((req, res) => {
    if (!addressedHere(req)) return json(res, 403, { error: 'Not for this host' })
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${actualPort}`)
    const path = url.pathname
    if (req.method === 'POST' && path === '/emails') return take(req, res)
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'No' })
    if (path === '/health') return json(res, 200, { ok: true, mails: mails.length })
    const to = url.searchParams.get('to')?.trim().toLowerCase() || null
    const listed = to ? mails.filter((m) => recipients(m).includes(to)) : mails
    if (path === '/') {
      return send(res, 200, 'text/html; charset=utf-8', indexPage(listed, to), {
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      })
    }
    if (path === '/mails') return json(res, 200, listed.map(summary))
    const match = /^\/mails\/([^/]+?)(\.html|\.txt)?$/.exec(path)
    if (match && MAIL_ID.test(match[1])) {
      const mail = mails.find((m) => m.id === match[1])
      if (!mail) return json(res, 404, { error: 'No such mail' })
      if (match[2] === '.html') {
        return send(res, 200, 'text/html; charset=utf-8', mail.html, {
          'Content-Security-Policy': MAIL_CSP,
        })
      }
      if (match[2] === '.txt') return send(res, 200, 'text/plain; charset=utf-8', mail.text ?? '')
      return json(res, 200, mail)
    }
    return json(res, 404, { error: 'Not found' })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  actualPort = server.address().port
  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      }),
  }
}
