/**
 * What `PUT /api/retirement/settings` refuses, and how it says it: 400 `{ error, fields }` by the
 * rules in shared/retirementPlanSchema.ts, which local-first and the planner run too.
 *
 * A save used to go through `normalizeSettings`, so what was sent was changed without a word: a
 * life expectancy of 30 was saved as 40, a lifestyle costing nothing was dropped, and a spending
 * period ending before it started lost its end. A plan read back and sent unchanged still saves,
 * whatever an older version stored. The local-first twin:
 * frontend/src/core/storage/__tests__/retirementPlanRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { RETIREMENT_PLAN_MESSAGES as M } from '../../shared/retirementPlanSchema';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../shared/retirementSettings';

const USER = 6350;
const PROFILE = 63500;

/** What an older version stored: nothing today's rules would take. */
const OLD_BLOB = {
  lifeExpectancyAge: 300,
  annualInflationPct: -4,
  netWorth: 'lots',
  lifestyles: [{ label: '', monthlySpendToday: 0 }],
};

/** A plan as the planner sends it: every field, edited. */
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
};

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM settings WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'retirement-plan@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Me')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('retirement_settings', ?, ?)"
    ).bind(JSON.stringify(OLD_BLOB), PROFILE),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

function api(method: string, path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function storedPlan(): Promise<unknown> {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'retirement_settings' AND profile_id = ?"
  )
    .bind(PROFILE)
    .first<{ value: string }>();
  return row ? JSON.parse(row.value) : null;
}

async function refusal(res: Response, fields: Record<string, string>): Promise<void> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string; fields: Record<string, string> };
  expect(body.fields).toEqual(fields);
  expect(body.error).toBe(Object.values(fields).join(' '));
}

describe('PUT /api/retirement/settings', () => {
  it('stores a plan that fits as it was sent, and answers it', async () => {
    const res = await api('PUT', '/api/retirement/settings', PLAN);
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { settings: unknown };
    expect(answer.settings).toEqual(normalizeSettings(PLAN));
    expect(await storedPlan()).toEqual(normalizeSettings(PLAN));
    expect((await storedPlan()) as object).toMatchObject({ monthlyIncome: 3200.5 });
  });

  it('saves the plan an older version stored, read back and sent unchanged', async () => {
    const read = (await (await api('GET', '/api/retirement/settings')).json()) as {
      settings: unknown;
    };
    const res = await api('PUT', '/api/retirement/settings', read.settings);
    expect(res.status).toBe(200);
    expect(await storedPlan()).toEqual(read.settings);
  });

  it('refuses a number outside its range at its field, where it used to move it in, and stores nothing', async () => {
    await refusal(
      await api('PUT', '/api/retirement/settings', {
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
    );
    expect(await storedPlan()).toEqual(OLD_BLOB);
  });

  it('refuses a lifestyle costing nothing and a period ending before it starts, where it dropped them', async () => {
    await refusal(
      await api('PUT', '/api/retirement/settings', {
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
    );
    expect(await storedPlan()).toEqual(OLD_BLOB);
  });
});
