/**
 * A capability for /api/v1 (signed-url.ts) is signed when an agent asks for one, and used up to
 * 15 minutes later. When it is used, POST /api/v1/import and GET /api/v1/snapshot read, in one
 * query, the account it was minted for and the API token it was minted from:
 * - an account waiting for its confirm link is answered 403 EMAIL_UNCONFIRMED, as the MCP server
 *   answers its token, and the same capability works once the address is confirmed;
 * - a capability from a revoked API token, or from one that does not exist, is answered as a link
 *   past its time.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { signCapability } from '../src/signed-url';
import type { SignedPurpose } from '../src/signed-url';
import { apiTokenRow } from './helpers/capability';
import cleanCsv from './fixtures/statement-clean.csv?raw';

const USER_ID = 9850;
const PROFILE_ID = 9852;
/** Another account, with an API token of its own. */
const OTHER_ID = 9853;
const SECRET = 'test-jwt-secret-not-for-prod';
const LIVE = 'tok-holds-live';
const REVOKED = 'tok-holds-revoked';
/** The other account's token. */
const ELSEWHERE = 'tok-holds-elsewhere';

const UNCONFIRMED = {
  error: 'Confirm your email address to use this account. Open the link we emailed you.',
  code: 'EMAIL_UNCONFIRMED',
};

const ROUTES: {
  name: string;
  purpose: SignedPurpose;
  expired: string;
  use: (sig: string) => Promise<Response>;
}[] = [
  {
    name: 'POST /api/v1/import',
    purpose: 'import',
    expired: 'Invalid or expired upload link.',
    use: (sig) => {
      const form = new FormData();
      form.append('file', new File([cleanCsv], 'statement.csv', { type: 'text/csv' }));
      return SELF.fetch(`https://api.example.com/api/v1/import?sig=${sig}&mode=preview`, {
        method: 'POST',
        body: form,
      });
    },
  },
  {
    name: 'GET /api/v1/snapshot',
    purpose: 'snapshot',
    expired: 'Invalid or expired download link.',
    use: (sig) => SELF.fetch(`https://api.example.com/api/v1/snapshot?sig=${sig}`),
  },
];

const sign = (purpose: SignedPurpose, tokenId: string) =>
  signCapability({ tokenId, userId: USER_ID, profileId: PROFILE_ID, purpose }, SECRET);

const setVerified = (verified: 0 | 1) =>
  env.DB.prepare('UPDATE users SET email_verified = ? WHERE id = ?').bind(verified, USER_ID).run();

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare('DELETE FROM import_logs WHERE profile_id = ?').bind(PROFILE_ID),
    env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE_ID),
    env.DB.prepare('DELETE FROM api_tokens WHERE user_id IN (?, ?)').bind(USER_ID, OTHER_ID),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE_ID),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(USER_ID, OTHER_ID),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, plan) VALUES (?, 'v1-holds@example.com', 'pbkdf2$100000$x$y', 'password', 0, 1, 'advanced')"
    ).bind(USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, name, user_id) VALUES (?, 'Holds', ?)").bind(
      PROFILE_ID,
      USER_ID
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version, plan) VALUES (?, 'v1-holds-other@example.com', 'pbkdf2$100000$x$y', 'password', 1, 1, 'advanced')"
    ).bind(OTHER_ID),
  ]);
  await apiTokenRow(LIVE, USER_ID);
  await apiTokenRow(REVOKED, USER_ID, true);
  await apiTokenRow(ELSEWHERE, OTHER_ID);
});

for (const route of ROUTES) {
  describe(route.name, () => {
    it('answers a capability of an account waiting for its confirm link 403 EMAIL_UNCONFIRMED, and the same capability as before once the address is confirmed', async () => {
      const sig = await sign(route.purpose, LIVE);

      const waiting = await route.use(sig);
      await setVerified(1);
      const confirmed = await route.use(sig);

      expect(waiting.status).toBe(403);
      expect(await waiting.json()).toEqual(UNCONFIRMED);
      expect(confirmed.status).toBe(200);
    });

    it('answers a capability from a revoked API token as a link past its time', async () => {
      await setVerified(1);

      const res = await route.use(await sign(route.purpose, REVOKED));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: route.expired });
    });

    it('answers a capability from an API token that does not exist as a link past its time', async () => {
      await setVerified(1);

      const res = await route.use(await sign(route.purpose, 'tok-holds-never-minted'));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: route.expired });
    });

    it("answers a capability from another account's API token as a link past its time", async () => {
      await setVerified(1);

      const res = await route.use(await sign(route.purpose, ELSEWHERE));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: route.expired });
    });
  });
}
