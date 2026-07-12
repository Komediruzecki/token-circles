/**
 * Regression tests for the audit security batch, against the real worker in workerd/Miniflare.
 *   - S1: cross-user category disclosure via an unowned category_id must not leak the category
 *         name/color through the bills / recurring / budgets / category-mappings reads.
 *   - S2: security headers are present on responses.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const SECRET = 'SECRET-CATEGORY-DivorceLawyer';

async function reset(): Promise<void> {
  // Delete children before parents — the test D1 enforces foreign keys.
  for (const t of [
    'transactions',
    'category_mappings',
    'bills',
    'budgets',
    'recurring_transactions',
    'accounts',
    'savings_goals',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

async function seed(): Promise<void> {
  await env.DB.batch([
    // Attacker (user 1, profile 1) and victim (user 2, profile 2).
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (1, 'attacker@example.com', 'password', 1), (2, 'victim@example.com', 'password', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO profiles (id, name, user_id) VALUES (1, 'Attacker', 1), (2, 'Victim', 2)"
    ),
    // The victim's private category (global sequential id, so it is guessable).
    env.DB.prepare(
      `INSERT INTO categories (id, name, type, color, profile_id) VALUES (999, '${SECRET}', 'expense', '#123456', 2)`
    ),
    // Attacker-owned rows that reference the victim's category id.
    env.DB.prepare(
      "INSERT INTO bills (id, profile_id, name, amount, category_id, due_date) VALUES (1, 1, 'Rent', 100, 999, '2026-05-01')"
    ),
    env.DB.prepare(
      "INSERT INTO recurring_transactions (id, profile_id, description, amount, category_id, next_date) VALUES (1, 1, 'Sub', 10, 999, '2026-05-01')"
    ),
    env.DB.prepare(
      "INSERT INTO budgets (id, profile_id, category_id, amount, start_date) VALUES (1, 1, 999, 50, '2026-05-01')"
    ),
    env.DB.prepare(
      "INSERT INTO category_mappings (id, profile_id, pattern, category_id, confidence) VALUES (1, 1, 'ACME', 999, 1)"
    ),
  ]);
}

let cookie = '';

beforeEach(async () => {
  await reset();
  await seed();
  const setCookie = await issueSessionCookie(1, 'password', env); // attacker's session
  cookie = setCookie.split(';')[0];
});

function api(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { Cookie: cookie, 'X-Profile-Id': '1' },
  });
}

describe('security — cross-user category disclosure (audit S1)', () => {
  it('does not leak a foreign category name through /api/bills', async () => {
    const res = await api('/api/bills');
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET);
  });

  it('does not leak a foreign category name through /api/recurring', async () => {
    const res = await api('/api/recurring');
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });

  it('does not leak a foreign category name through /api/budgets/improvements', async () => {
    const res = await api('/api/budgets/improvements');
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });

  it('does not leak a foreign category name through /api/categories/mappings', async () => {
    const res = await api('/api/categories/mappings');
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });
});

describe('security — response headers (audit S2)', () => {
  it('sets framing, sniffing, transport and CSP headers', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});
