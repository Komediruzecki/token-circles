/**
 * Two regressions in the read tools.
 *
 * Paging: `truncated` was derived by comparing the page size against the total row count, which
 * cannot tell a full LAST page from a full middle one -- the final page reported more to come and
 * handed back a cursor that returned nothing, so an agent paging to exhaustion never terminated.
 *
 * Scoping: whoami's per-profile currency lookup queried the settings table with no user filter.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { mintApiToken } from '../src/apitoken';

const USER_ID = 9500;
const PROFILE_ID = 9501;
const OTHER_USER_ID = 9510;
const OTHER_PROFILE_ID = 9511;
const PAGE = 6;
const TOTAL = 18;
let secret = '';

async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await SELF.fetch('https://api.example.com/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as any;
  if (body.result?.isError) throw new Error(body.result.content[0].text);
  if (!body.result) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body.result.structuredContent;
}

beforeAll(async () => {
  for (const [uid, pid, email, name] of [
    [USER_ID, PROFILE_ID, 'page@example.com', 'Paged'],
    [OTHER_USER_ID, OTHER_PROFILE_ID, 'other@example.com', 'Other'],
  ] as const) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1)"
    )
      .bind(uid, email)
      .run();
    await env.DB.prepare('INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, ?, ?)')
      .bind(pid, name, uid)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO accounts (id, name, type, currency, balance, profile_id) VALUES (95010, 'Checking', 'giro', 'EUR', 0, ?)"
  )
    .bind(PROFILE_ID)
    .run();

  // Distinct dates so the (date DESC, id DESC) keyset is total and paging is deterministic.
  for (let i = 0; i < TOTAL; i++) {
    const day = String(i + 1).padStart(2, '0');
    await env.DB.prepare(
      "INSERT INTO transactions (date, description, amount, type, currency, account_id, profile_id) VALUES (?, ?, -1, 'expense', 'EUR', 95010, ?)"
    )
      .bind(`2026-03-${day}`, `Row ${i}`, PROFILE_ID)
      .run();
  }

  // The other user's base currency. Before the fix whoami read this row for every user.
  await env.DB.prepare(
    "INSERT INTO settings (key, value, profile_id) VALUES ('currency', 'JPY', ?)"
  )
    .bind(OTHER_PROFILE_ID)
    .run();

  secret = (
    await mintApiToken(env.DB, USER_ID, {
      name: 'pager',
      scopes: ['read'],
      defaultProfileId: PROFILE_ID,
    })
  ).secret;
});

describe('list_transactions paging', () => {
  it('clears `truncated` on a full final page instead of looping forever', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const res: any = await call('list_transactions', {
        profileId: PROFILE_ID,
        limit: PAGE,
        ...(cursor ? { cursor } : {}),
      });
      pages++;
      seen.push(...res.rows.map((r: { description: string }) => r.description));
      // The bug: page 3 returned 6 rows, saw totalCount 18 > 6, and claimed more.
      if (pages === TOTAL / PAGE) {
        expect(res.truncated).toBe(false);
        expect(res.nextCursor).toBeNull();
      }
      cursor = res.nextCursor;
      expect(pages).toBeLessThanOrEqual(TOTAL / PAGE);
    } while (cursor);

    expect(pages).toBe(TOTAL / PAGE);
    expect(new Set(seen).size).toBe(TOTAL);
  });

  it('still reports more to come on a full middle page', async () => {
    const first = await call('list_transactions', { profileId: PROFILE_ID, limit: PAGE });
    expect(first.rows).toHaveLength(PAGE);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    expect(first.totalCount).toBe(TOTAL);
  });

  it('returns a short page with no cursor', async () => {
    const all = await call('list_transactions', { profileId: PROFILE_ID, limit: TOTAL + 5 });
    expect(all.rows).toHaveLength(TOTAL);
    expect(all.truncated).toBe(false);
    expect(all.nextCursor).toBeNull();
  });
});

describe('whoami', () => {
  it("reports only the caller's own profiles, and no other user's currency", async () => {
    const me = await call('whoami');
    expect(me.profiles.map((p: { id: number }) => p.id)).toEqual([PROFILE_ID]);
    expect(JSON.stringify(me)).not.toContain('JPY');
  });
});
