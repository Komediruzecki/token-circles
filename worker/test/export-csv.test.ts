import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// CSV export: the formula-injection guard must quote attacker-shaped STRINGS but leave
// plain numbers alone — it used to turn every negative balance into text ("'-2392.21").

let cookie = '';

beforeEach(async () => {
  for (const t of ['accounts', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (60, 'csv@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (600, 60, 'Main')"),
    env.DB.prepare(
      "INSERT INTO accounts (profile_id, name, type, currency, balance) VALUES (600, 'WRev', 'giro', 'USD', -2392.21)"
    ),
    env.DB.prepare(
      "INSERT INTO accounts (profile_id, name, type, currency, balance) VALUES (600, '=HYPERLINK(\"http://evil\")', 'giro', 'USD', 10)"
    ),
  ]);
  cookie = (await issueSessionCookie(60, 'password', env)).split(';')[0];
});

describe('GET /api/export/accounts (CSV)', () => {
  it('exports negative balances as plain numbers, not quoted text', async () => {
    const res = await SELF.fetch('https://example.com/api/export/accounts?format=csv', {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('-2392.21');
    expect(csv).not.toContain("'-2392.21");
  });

  it('still quotes formula-shaped strings', async () => {
    const res = await SELF.fetch('https://example.com/api/export/accounts?format=csv', {
      headers: { Cookie: cookie },
    });
    const csv = await res.text();
    expect(csv).toContain("'=HYPERLINK");
  });
});
