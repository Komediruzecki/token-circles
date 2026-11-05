/**
 * The E2E suite reads the mails a person would get: playwright.config.ts starts the local mailbox
 * (scripts/mailbox.mjs) before the Worker, and hands the Worker its address as DEV_MAIL_SINK, with
 * mail links that name this run's own app and Worker (worker/src/email.ts, devMailSink).
 */
import { describe, expect, it } from 'vitest'
import playwrightConfig from '../../playwright.config'
import { E2E_API_PORT, E2E_MAIL_BASE, E2E_MAIL_PORT, E2E_PORT } from '../../tests/e2e-constants'

const servers = [playwrightConfig.webServer ?? []].flat()
const indexOf = (script: string) => servers.findIndex((server) => server.command?.includes(script))

describe('the E2E mailbox', () => {
  it('starts before the Worker, on its own port, and is stopped with a signal it handles', () => {
    const mailbox = indexOf('scripts/mailbox.mjs')
    const worker = indexOf('scripts/serve-worker.mjs')
    expect(mailbox, 'a webServer runs scripts/mailbox.mjs').toBeGreaterThanOrEqual(0)
    expect(mailbox).toBeLessThan(worker)
    const entry = servers[mailbox]
    expect(entry.command).toContain(`--port ${String(E2E_MAIL_PORT)}`)
    expect(entry.url).toBe(`${E2E_MAIL_BASE}/health`)
    expect(entry.gracefulShutdown).toEqual({ signal: 'SIGTERM', timeout: 5000 })
  })

  it("is where the Worker's mails go, and their links name this run's app and Worker", () => {
    const entry = servers[indexOf('scripts/serve-worker.mjs')]
    expect(JSON.parse(entry.env?.WORKER_VARS ?? '{}')).toEqual({
      DEV_MAIL_SINK: `${E2E_MAIL_BASE}/emails`,
      CORS_ORIGIN: `http://localhost:${String(E2E_PORT)}`,
      API_PUBLIC_ORIGIN: `http://localhost:${String(E2E_API_PORT)}`,
    })
  })
})
