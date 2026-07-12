/**
 * Audit "import correctness + security hardening" regressions for worker/src/routes/imports.ts,
 * run against the real worker in workerd via Miniflare (D1 from worker/migrations/).
 *   - I2: parseDateString must NOT roll a month>12 into the next year, and must format from
 *         explicit y/m/d (no timezone shift). "04/13/2026" → 2026-04-13 (month-first, 13>12).
 *   - I1: transaction amounts use European-aware parsing — "1.234,56" stores 1234.56, not 1.234.
 *   - S8: /api/import/upload rejects an oversized body with 413 BEFORE parsing it.
 *
 * Worker deps can't install in the CI sandbox — run locally with `pnpm -C worker test`.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const USER = 700;
const PROFILE = 7000;
let cookie = '';

beforeEach(async () => {
  for (const t of [
    'transactions',
    'account_balance_history',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'importer@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      PROFILE,
      USER,
      'Main'
    ),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

function execute(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/import/execute', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: JSON.stringify(body),
  });
}

async function txByDescription(
  description: string
): Promise<{ date: string; amount: number } | null> {
  return env.DB.prepare(
    'SELECT date, amount FROM transactions WHERE profile_id = ? AND description = ?'
  )
    .bind(PROFILE, description)
    .first<{ date: string; amount: number }>();
}

describe('import date parsing (audit I2)', () => {
  it('"04/13/2026" is 2026-04-13 (month-first), NOT a 2027 rollover', async () => {
    const res = await execute({
      rows: [['DateMonthOverflow', '04/13/2026', '10']],
      mapping: { description: 0, date: 1, amount: 2 },
    });
    expect(res.status).toBe(200);
    const tx = await txByDescription('DateMonthOverflow');
    expect(tx?.date).toBe('2026-04-13');
    expect(tx?.date.startsWith('2027')).toBe(false);
  });

  it('an unambiguous EU date "13/04/2026" stays day-first → 2026-04-13', async () => {
    const res = await execute({
      rows: [['DateDayFirst', '13/04/2026', '10']],
      mapping: { description: 0, date: 1, amount: 2 },
    });
    expect(res.status).toBe(200);
    expect((await txByDescription('DateDayFirst'))?.date).toBe('2026-04-13');
  });

  it('an ISO date is preserved verbatim (no timezone shift)', async () => {
    const res = await execute({
      rows: [['DateIso', '2026-04-13', '10']],
      mapping: { description: 0, date: 1, amount: 2 },
    });
    expect(res.status).toBe(200);
    expect((await txByDescription('DateIso'))?.date).toBe('2026-04-13');
  });

  it('a genuinely invalid date (both fields > 12) falls back to today(), not a rollover', async () => {
    const today = new Date().toISOString().split('T')[0];
    const res = await execute({
      rows: [['DateInvalid', '13/13/2026', '10']],
      mapping: { description: 0, date: 1, amount: 2 },
    });
    expect(res.status).toBe(200);
    const tx = await txByDescription('DateInvalid');
    expect(tx?.date).toBe(today);
    expect(tx?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('import amount parsing (audit I1)', () => {
  it('European "1.234,56" stores 1234.56, not 1.234', async () => {
    const res = await execute({
      rows: [['AmtEuro', '2026-01-15', '1.234,56']],
      mapping: { description: 0, date: 1, amount: 2 },
    });
    expect(res.status).toBe(200);
    const tx = await txByDescription('AmtEuro');
    expect(tx?.amount).toBeCloseTo(1234.56, 2);
    expect(tx?.amount).not.toBeCloseTo(1.234, 2);
  });

  it('US "1,234.56" also stores 1234.56 (last separator is the decimal)', async () => {
    const res = await execute({
      rows: [['AmtUs', '2026-01-15', '1,234.56']],
      mapping: { description: 0, date: 1, amount: 2 },
    });
    expect(res.status).toBe(200);
    expect((await txByDescription('AmtUs'))?.amount).toBeCloseTo(1234.56, 2);
  });

  it('a lone-comma decimal "1234,56" stores 1234.56', async () => {
    const res = await execute({
      rows: [['AmtComma', '2026-01-15', '1234,56']],
      mapping: { description: 0, date: 1, amount: 2 },
    });
    expect(res.status).toBe(200);
    expect((await txByDescription('AmtComma'))?.amount).toBeCloseTo(1234.56, 2);
  });
});

describe('import upload size cap (audit S8)', () => {
  it('rejects an oversized upload with 413 before parsing', async () => {
    const oversized = new Uint8Array(11 * 1024 * 1024); // 11 MB > 10 MB cap
    const fd = new FormData();
    fd.append('file', new File([oversized], 'big.csv', { type: 'text/csv' }));
    const res = await SELF.fetch('https://example.com/api/import/upload', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: fd,
    });
    expect(res.status).toBe(413);
  });

  it('accepts a small CSV upload (guard does not block normal files)', async () => {
    const fd = new FormData();
    fd.append('file', new File(['date,amount\n2026-01-01,10'], 'ok.csv', { type: 'text/csv' }));
    const res = await SELF.fetch('https://example.com/api/import/upload', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: fd,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { headers: string[] };
    expect(json.headers).toEqual(['date', 'amount']);
  });
});
