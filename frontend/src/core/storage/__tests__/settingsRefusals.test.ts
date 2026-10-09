/**
 * What local-first's `PUT /api/settings` refuses, and how it says it: the twin of
 * worker/test/settings-refusals.test.ts, by the same rules (shared/settingsSchema.ts), through
 * `routeApiRequest`, the router `apiFetch` calls, with older rows in place.
 *
 * Before, local-first stored any key as it came: a retirement plan under `retirement_settings:<id>`
 * that the plan rules never saw, the email settings, and the rows the app keeps for itself (the
 * parked backup extensions, the exchange-rate cache). An array body became keys "0", "1" and so
 * on. A currency code that is not one answered 409, as if it were the lock on the base currency,
 * and the lock named no field.
 *
 * Its `POST /api/storage-mode` switched the browser's mode itself, which the Worker cannot do, and
 * took any mode at all. Now both acknowledge a mode there is such a thing as, and Settings sets it.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SETTINGS_MESSAGES as M } from '../../../../../shared/settingsSchema'
import { getDB } from '../idb'

let routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>

beforeAll(async () => {
  routeApiRequest = (await import('../localApiRouter')).routeApiRequest
}, 120_000)

const PLAN = { birthMonth: '1986-04', retirementAge: 67 }
const RATES = { fetchedAt: '2026-01-02T09:00:00.000Z', rates: { USD: 1.1 } }

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  const db = await getDB()
  for (const store of ['profiles', 'accounts', 'transactions', 'settings'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  // What the browser already holds: a base currency, a retirement plan, the exchange-rate cache.
  await db.put('settings', { key: 'currency', value: 'EUR' })
  await db.put('settings', { key: 'primary_currency', value: 'EUR' })
  await db.put('settings', { key: 'retirement_settings:1', value: PLAN })
  await db.put('settings', { key: '__cache__exchange_rates', value: RATES })
})

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function answer(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() }
}

async function stored(): Promise<Record<string, unknown>> {
  const rows = (await (await getDB()).getAll('settings')) as { key: string; value: unknown }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

const BEFORE = {
  currency: 'EUR',
  primary_currency: 'EUR',
  'retirement_settings:1': PLAN,
  __cache__exchange_rates: RATES,
}

const refusal = (fields: Record<string, string>) => ({
  status: 400,
  body: { error: Object.values(fields).join(' '), fields },
})

describe('PUT /api/settings in local-first', () => {
  it('refuses the retirement plan, under either key, and keeps the stored one', async () => {
    for (const key of ['retirement_settings', 'retirement_settings:1']) {
      const res = await call('PUT', '/api/settings', { [key]: { retirementAge: 30 } })
      expect(await answer(res)).toEqual(refusal({ [key]: M.retirementPlan }))
    }
    expect(await stored()).toEqual(BEFORE)
  })

  it('refuses the email settings and what the app keeps for itself', async () => {
    const res = await call('PUT', '/api/settings', {
      email_notifications: 'false',
      __cache__exchange_rates: {},
      __backup_v3_extensions__: '{}',
    })
    expect(await answer(res)).toEqual(
      refusal({
        email_notifications: M.emailSettings,
        __cache__exchange_rates: M.appOwned,
        __backup_v3_extensions__: M.appOwned,
      })
    )
    expect(await stored()).toEqual(BEFORE)
  })

  it('stores none of a write that has a refused setting in it', async () => {
    const res = await call('PUT', '/api/settings', {
      onboarding: 'completed',
      'retirement_settings:1': {},
    })
    expect(res.status).toBe(400)
    expect(await stored()).toEqual(BEFORE)
  })

  it('refuses a currency that is not one at the currency, not as the lock', async () => {
    for (const currency of ['', 'EURO', 12]) {
      const res = await call('PUT', '/api/settings', { currency })
      expect(await answer(res)).toEqual(refusal({ currency: M.currency }))
    }
    expect(await stored()).toEqual(BEFORE)
  })

  it('takes a lowercase currency code, and stores it in capitals', async () => {
    expect(await answer(await call('PUT', '/api/settings', { currency: 'usd' }))).toEqual({
      status: 200,
      body: { ok: true },
    })
    expect(await stored()).toMatchObject({ currency: 'USD', primary_currency: 'USD' })
  })

  it('refuses a value that is not text, a number, or true or false', async () => {
    const res = await call('PUT', '/api/settings', { preferences: { theme: 'dark' } })
    expect(await answer(res)).toEqual(refusal({ preferences: M.value }))
    expect(await stored()).toEqual(BEFORE)
  })

  it('refuses a body that is not names and values', async () => {
    expect(await answer(await call('PUT', '/api/settings', ['USD']))).toEqual(
      refusal({ settings: M.settings })
    )
    expect(await stored()).toEqual(BEFORE)
  })

  it('says why a locked base currency stays, at the currency', async () => {
    await (
      await getDB()
    ).add('accounts', {
      id: 1,
      profile_id: 1,
      name: 'Everyday',
      type: 'giro',
      currency: 'EUR',
    } as never)
    const words = 'The base currency stays EUR once you have accounts or transactions.'
    expect(await answer(await call('PUT', '/api/settings', { currency: 'USD' }))).toEqual({
      status: 409,
      body: { error: words, fields: { currency: words } },
    })
    expect(await stored()).toEqual(BEFORE)
  })

  it('still stores what the app sends', async () => {
    const badges = JSON.stringify({ v: 1, unlocks: [], dismissedAdvice: [] })
    const res = await call('PUT', '/api/settings', {
      onboarding: 'skipped',
      'achievements:1': badges,
    })
    expect(await answer(res)).toEqual({ status: 200, body: { ok: true } })
    expect(await stored()).toEqual({ ...BEFORE, onboarding: 'skipped', 'achievements:1': badges })
  })
})

describe('the storage mode in local-first', () => {
  it('names this browser, acknowledges a switch without making it, and refuses a mode there is no such thing as', async () => {
    expect(await answer(await call('GET', '/api/storage-mode'))).toEqual({
      status: 200,
      body: { mode: 'serverless' },
    })
    for (const path of ['/api/storage-mode', '/api/settings/set-storage']) {
      expect(await answer(await call('POST', path, { mode: 'self-hosted' }))).toEqual({
        status: 200,
        body: { ok: true, mode: 'self-hosted' },
      })
      // Settings sets the mode itself, after the answer.
      expect(localStorage.getItem('finance_storage_mode')).toBe('serverless')
      expect(await answer(await call('POST', path, { mode: 'cloud' }))).toEqual(
        refusal({ mode: M.mode })
      )
    }
  })
})
