/**
 * "Keep my data in this browser only" from a signed-in account's setup (3 Nov review A3). The
 * switch only reloaded into the local workspace, so the account, empty, still got the day-2 and
 * day-7 mails, and the confirm had said "no account is needed". Now it turns the account's
 * first-week mails off on the Worker first, and goes ahead whatever the answer.
 *
 * The wizard as App mounts it, on the account's space step, against a stand-in for the Worker.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { answerUserStateValue } from '../../../../../shared/accountState'
import { __resetAccountStateForTest, readAccountState } from '../../../core/accountState'
import { setCurrentProfile, setProfiles } from '../../../core/appStore'
import { confirmRequests, resolveConfirm } from '../../../core/confirmStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import {
  onboardingOpen,
  prevOnboardingStep,
  setOnboardingOwner,
  skipOnboarding,
  startOnboarding,
} from '../../../core/onboardingStore'
import { getDB } from '../../../core/storage/idb'
import { setStorageMode } from '../../../core/storage/storageFactory'
import type { OnboardingRecord } from '../../../../../shared/accountStateKeys'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The Worker: the account's setup record, how it answers the mails' switch, what it was sent. */
const worker = {
  record: null as OnboardingRecord | null,
  accounts: [] as Array<{ id: number; name: string; currency: string; balance: number }>,
  mails: 'ok' as 'ok' | 'refused' | 'unreachable',
  sent: [] as string[],
  /** The storage mode when the mails' switch was sent: the switch must not have happened yet. */
  modeAtMails: null as string | null,
}

function workerStandIn() {
  return async (url: string, init: RequestInit = {}) => {
    const path = new URL(url, 'http://localhost').pathname
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? init.body : ''
    worker.sent.push(`${method} ${path}${body ? ` ${body}` : ''}`)
    if (path === '/api/account/state' && method === 'GET') {
      return json({
        onboarding: answerUserStateValue(
          'onboarding',
          worker.record ? JSON.stringify(worker.record) : null
        ),
        tours: null,
        getting_started: null,
      })
    }
    if (path === '/api/accounts' && method === 'GET') return json(worker.accounts)
    if (path === '/api/notifications/settings' && method === 'PUT') {
      worker.modeAtMails = localStorage.getItem('finance_storage_mode')
      if (worker.mails === 'unreachable') throw new TypeError('Failed to fetch')
      if (worker.mails === 'refused') return json({ error: 'Something went wrong.' }, 500)
      return json({ ok: true })
    }
    return method === 'GET' ? json([]) : json({})
  }
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let reloads = 0

beforeAll(async () => {
  await import('../OnboardingWizard')
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  setStorageMode('self-hosted')
  localStorage.setItem('localCurrency', 'EUR')
  vi.stubEnv('MODE', 'production')
  __resetDataVersionsForTest()
  worker.record = null
  worker.accounts = []
  worker.mails = 'ok'
  worker.sent = []
  worker.modeAtMails = null
  vi.stubGlobal('fetch', workerStandIn())
  reloads = 0
  vi.stubGlobal('location', {
    reload: () => {
      reloads += 1
    },
    href: 'https://app.example.com/',
    pathname: '/',
    search: '',
    hash: '',
  } as unknown as Location)
  // This browser's local workspace holds nothing.
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  setCurrentProfile(null)
  setProfiles([])
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  if (onboardingOpen()) skipOnboarding()
  setOnboardingOwner(null)
  __resetAccountStateForTest()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/**
 * Sign the account in, open its setup on the space step, and choose local-only, confirmed. From
 * `from`, setup opens there first and goes back to the space, as after a reload mid-setup.
 */
async function chooseLocalOnly(from: 'space' | 'account' = 'space'): Promise<string> {
  __resetAccountStateForTest()
  setOnboardingOwner('account-5')
  await readAccountState()
  startOnboarding(from)
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)
  if (from === 'account') {
    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="onboarding-step-account"]')).not.toBeNull()
      expect(worker.sent).toContain('GET /api/accounts')
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    prevOnboardingStep()
  }
  const button = await vi.waitFor(() => {
    const found = host.querySelector<HTMLButtonElement>('[data-test-id="onboarding-local-only"]')
    expect(found).not.toBeNull()
    return found!
  })
  button.click()
  await vi.waitFor(() => {
    expect(confirmRequests()).toHaveLength(1)
  })
  // The confirm as it reads: its heading, then its lines (review D5).
  const { title, message } = confirmRequests()[0]
  const question = [title, ...(typeof message === 'string' ? [message] : message)].join(' ')
  resolveConfirm(confirmRequests()[0].id, true)
  await vi.waitFor(() => {
    expect(reloads).toBe(1)
  })
  return question
}

const mailsOff = 'PUT /api/notifications/settings {"weekOneMails":false}'

it("turns the account's first-week mails off before the switch, and says so", async () => {
  const question = await chooseLocalOnly()
  expect(question).toBe(
    'Keep your data in this browser only? Nothing syncs to the cloud, and Settings can switch back. Your account stays empty and sends no first-week mails.'
  )
  expect(worker.sent).toContain(mailsOff)
  // Sent to the Worker, before the mode changed: after it, the request would go to the browser.
  expect(worker.modeAtMails).toBe('self-hosted')
  expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')
})

it('switches all the same when the Worker refuses or cannot be reached', async () => {
  worker.mails = 'refused'
  await chooseLocalOnly()
  expect(worker.sent).toContain(mailsOff)
  expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')

  dispose?.()
  dispose = undefined
  if (onboardingOpen()) skipOnboarding()
  setStorageMode('self-hosted')
  reloads = 0
  worker.mails = 'unreachable'
  worker.sent = []
  await chooseLocalOnly()
  expect(worker.sent).toContain(mailsOff)
  expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')
})

it('says the account stays as it is when setup runs again over one that finished it', async () => {
  worker.record = {
    step: 'done',
    outcome: 'completed',
    started_at: '2026-09-01 10:00:00',
    finished_at: '2026-09-01 10:05:00',
  } as OnboardingRecord
  const question = await chooseLocalOnly()
  expect(question).toContain('Your account stays as it is and sends no first-week mails.')
  expect(question).not.toContain('empty')
  expect(worker.sent).toContain(mailsOff)
})

it('says the account stays as it is once setup has made an account on it', async () => {
  // A reload mid-setup opens on the account step; the account made there is on the account.
  worker.record = {
    step: 'account',
    outcome: null,
    started_at: '2026-11-03 09:00:00',
    finished_at: null,
  }
  worker.accounts = [{ id: 1, name: 'Main account', currency: 'EUR', balance: 120 }]
  const question = await chooseLocalOnly('account')
  expect(question).toContain('Your account stays as it is and sends no first-week mails.')
  expect(worker.sent).toContain(mailsOff)
})

it('asks nothing of the Worker when the switch is cancelled', async () => {
  __resetAccountStateForTest()
  setOnboardingOwner('account-5')
  await readAccountState()
  startOnboarding('space')
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)
  const button = await vi.waitFor(() => {
    const found = host.querySelector<HTMLButtonElement>('[data-test-id="onboarding-local-only"]')
    expect(found).not.toBeNull()
    return found!
  })
  button.click()
  await vi.waitFor(() => {
    expect(confirmRequests()).toHaveLength(1)
  })
  resolveConfirm(confirmRequests()[0].id, false)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(worker.sent).not.toContain(mailsOff)
  expect(localStorage.getItem('finance_storage_mode')).toBe('self-hosted')
  expect(reloads).toBe(0)
})
