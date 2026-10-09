/**
 * What local-first's `PUT /retirement/settings` refuses, and how it says it: the same 400
 * `{ error, fields }` as the Worker, by the same rules (shared/retirementPlanSchema.ts).
 *
 * A save used to go through `normalizeSettings`, so a life expectancy of 30 was saved as 40, a
 * lifestyle costing nothing was dropped, and a spending period ending before it started lost its
 * end, without a word. The Worker twin: worker/test/retirement-plan-refusals.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { RETIREMENT_PLAN_MESSAGES as M } from '../../../../../shared/retirementPlanSchema'
import { DEFAULT_SETTINGS, normalizeSettings } from '../../../../../shared/retirementSettings'
import { getDB } from '../idb'
import { routeApiRequest } from '../localApiRouter'

const OLD_BLOB = {
  lifeExpectancyAge: 300,
  annualInflationPct: -4,
  netWorth: 'lots',
  lifestyles: [{ label: '', monthlySpendToday: 0 }],
}

const PLAN = {
  ...DEFAULT_SETTINGS,
  mode: 'advanced',
  netWorth: 30000,
  monthlyIncome: 3200.5,
  birthMonth: '1986-04',
  expensePeriods: [{ fromMonth: '2027-01', toMonth: '2027-12', monthlyAmount: 400 }],
  lifestyles: [
    { id: 'default', label: 'Modest', monthlySpendToday: 1250 },
    { id: 'comfortable', label: 'Comfortable', monthlySpendToday: 2400 },
  ],
}

const KEY = 'retirement_settings:1'

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function storedPlan(): Promise<unknown> {
  return ((await (await getDB()).get('settings', KEY)) as { value: unknown } | undefined)?.value
}

async function refusal(res: Response, fields: Record<string, string>): Promise<void> {
  expect(res.status).toBe(400)
  const body = (await res.json()) as { error: string; fields: Record<string, string> }
  expect(body.fields).toEqual(fields)
  expect(body.error).toBe(Object.values(fields).join(' '))
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: KEY, value: OLD_BLOB })
})

describe('PUT /retirement/settings', () => {
  it('stores a plan that fits as it was sent, and answers it', async () => {
    const res = await call('PUT', '/retirement/settings', PLAN)
    expect(res.status).toBe(200)
    const answer = (await res.json()) as { settings: unknown }
    expect(answer.settings).toEqual(normalizeSettings(PLAN))
    expect(await storedPlan()).toEqual(normalizeSettings(PLAN))
  })

  it('saves the plan an older version stored, read back and sent unchanged', async () => {
    const read = (await (await call('GET', '/retirement/settings')).json()) as { settings: unknown }
    const res = await call('PUT', '/retirement/settings', read.settings)
    expect(res.status).toBe(200)
    expect(await storedPlan()).toEqual(read.settings)
  })

  it('refuses a number outside its range at its field, where it used to move it in, and stores nothing', async () => {
    await refusal(
      await call('PUT', '/retirement/settings', {
        ...PLAN,
        lifeExpectancyAge: 30,
        annualInflationPct: 60,
        safeWithdrawalRatePct: 0,
      }),
      {
        lifeExpectancyAge: M.lifeExpectancyAge,
        annualInflationPct: M.annualInflationPct,
        safeWithdrawalRatePct: M.safeWithdrawalRatePct,
      }
    )
    expect(await storedPlan()).toEqual(OLD_BLOB)
  })

  it('refuses a lifestyle costing nothing and a period ending before it starts, where it dropped them', async () => {
    await refusal(
      await call('PUT', '/retirement/settings', {
        ...PLAN,
        expensePeriods: [{ fromMonth: '2027-05', toMonth: '2027-01', monthlyAmount: 400 }],
        lifestyles: [
          { id: 'default', label: 'Modest', monthlySpendToday: 1250 },
          { id: 'later', label: 'Later', monthlySpendToday: 0 },
        ],
      }),
      {
        'expensePeriods.0.toMonth': M.periodEnd,
        'lifestyles.1.monthlySpendToday': M.lifestyleSpend,
      }
    )
    expect(await storedPlan()).toEqual(OLD_BLOB)
  })
})
