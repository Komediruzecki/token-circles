// ============================================================
// mailbox — run the local mailbox (lib/mailbox.mjs) that a development Worker's mails go to.
//
//   node scripts/mailbox.mjs --port 8797 --dir test-results/mailbox
//
// The Worker sends there when it runs with DEV_MAIL_SINK=http://127.0.0.1:<port>/emails, APP_ENV
// 'development' and no RESEND_API_KEY (worker/src/email.ts). playwright.config.ts starts it for the
// E2E suite; tests/time-machine/cli.ts starts it for a stack a person or an agent drives by hand.
// Open http://127.0.0.1:<port>/ to read what came. It stops on SIGINT or SIGTERM.
// ============================================================
import { resolve } from 'node:path'
import { startMailbox } from './lib/mailbox.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const port = Number(arg('--port', process.env.E2E_MAIL_PORT || 8797))
const dir = resolve(arg('--dir', process.env.E2E_MAILBOX_DIR || 'test-results/mailbox'))

let box
try {
  box = await startMailbox({ port, dir })
} catch (err) {
  console.error(`[mailbox] could not listen on 127.0.0.1:${port}: ${err.message}`)
  process.exit(1)
}
console.log(`[mailbox] listening on ${box.url}, keeping mails in ${dir}`)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void box.close().then(() => process.exit(0))
    // A connection that will not close must not keep the process alive past its stop.
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
