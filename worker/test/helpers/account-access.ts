/**
 * An account set up with every kind of access the app offers, for the tests of the routes that
 * confirm an address: Google sign-in, an emailed sign-in code and a reset link. Each test file
 * passes ids of its own, so files sharing the test database never touch each other's rows.
 */
import { env, SELF } from 'cloudflare:test';
import { hashPassword, verifyPassword } from '../../src/auth';
import { unconfirmedSessionCookie } from './session';
import { mintApiToken } from '../../src/apitoken';
import { generateTotpSecret } from '../../src/totp';
import {
  confirmTotp,
  enrollTotp,
  generateRecoveryCodes,
  storeRecoveryCodes,
} from '../../src/twofa';

/** Every table that holds a way into an account, keyed by the account. */
export const ACCESS_TABLES = [
  'auth_sessions',
  'webauthn_credentials',
  'totp_credentials',
  'recovery_codes',
  'api_tokens',
  'password_resets',
  'login_codes',
  'email_verifications',
] as const;

export type AccessRows = Record<(typeof ACCESS_TABLES)[number], Array<Record<string, unknown>>>;

/** The password seedAccount sets. */
export const PASSWORD = 'the-password-from-signup';

export interface SeededAccount {
  /** A session issued before the test acts, as the `fm_session=...` pair a request sends. */
  session: string;
  /** An API token's secret, which the MCP server accepts. */
  apiToken: string;
  /** The secret behind the account's confirmed TOTP. */
  totpSecret: string;
}

/**
 * Account `id` at `email`, with every kind of access the app can set up on one (a password, a
 * session, a passkey, confirmed TOTP with recovery codes, an API token, and an unused reset link,
 * sign-in code and confirm link), and the data seededData describes.
 */
export async function seedAccount(
  id: number,
  email: string,
  emailVerified: 0 | 1
): Promise<SeededAccount> {
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, email_verified, auth_provider, token_version, plan) VALUES (?, ?, ?, ?, 'password', 1, 'basic')"
  )
    .bind(id, email, await hashPassword(PASSWORD), emailVerified)
    .run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Household')").bind(
      id,
      id
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Current', 'giro', 'EUR', 100, 100)"
    ).bind(id + 1, id),
    env.DB.prepare(
      "INSERT INTO transactions (id, profile_id, description, amount, date, account_id) VALUES (?, ?, 'Groceries', 12.5, '2026-10-01', ?)"
    ).bind(id + 2, id, id + 1),
    env.DB.prepare(
      "INSERT INTO webauthn_credentials (id, user_id, public_key) VALUES (?, ?, 'public-key')"
    ).bind(`passkey-${id}`, id),
    env.DB.prepare(
      "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))"
    ).bind(id, `reset-hash-${id}`),
    env.DB.prepare(
      "INSERT INTO login_codes (user_id, email, code_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+10 minutes'))"
    ).bind(id, email, `code-hash-${id}`),
    env.DB.prepare(
      "INSERT INTO email_verifications (user_id, email, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+1 day'))"
    ).bind(id, email, `confirm-hash-${id}`),
  ]);
  const totpSecret = generateTotpSecret();
  await enrollTotp(env, id, totpSecret);
  await confirmTotp(env, id);
  await storeRecoveryCodes(env, id, generateRecoveryCodes());
  const token = await mintApiToken(env.DB, id, { name: 'Nightly import', scopes: ['read'] });
  // The address stays as `emailVerified` says: this session does not confirm it.
  const session = (await unconfirmedSessionCookie(id, 'password', env)).split(';')[0]!;
  return { session, apiToken: token.secret, totpSecret };
}

/**
 * Run `setUp` with account `id`'s address counted as confirmed, then put email_verified back as
 * it was. A session of an account whose address waits for its link is refused everything that
 * adds a way in or changes the address (EMAIL_UNCONFIRMED), but an account made before that rule
 * may have set either up already: a test of such an account sets it up through here.
 */
export async function whileConfirmed<T>(id: number, setUp: () => Promise<T>): Promise<T> {
  const before = await env.DB.prepare('SELECT email_verified FROM users WHERE id = ?')
    .bind(id)
    .first<{ email_verified: number }>();
  if (!before) throw new Error(`whileConfirmed: there is no user ${id}`);
  const setVerified = (value: number) =>
    env.DB.prepare('UPDATE users SET email_verified = ? WHERE id = ?').bind(value, id).run();
  await setVerified(1);
  try {
    return await setUp();
  } finally {
    await setVerified(before.email_verified);
  }
}

/** What seedAccount puts in besides access, in the shape dataRows reads it back. */
export function seededData(id: number) {
  return {
    profiles: [{ id, name: 'Household' }],
    accounts: [{ id: id + 1, balance: 100 }],
    transactions: [{ id: id + 2, amount: 12.5 }],
  };
}

/** The account's data as it stands, in the shape seededData describes. */
export async function dataRows(id: number) {
  const rows = async (sql: string) => (await env.DB.prepare(sql).bind(id).all()).results;
  return {
    profiles: await rows('SELECT id, name FROM profiles WHERE user_id = ? ORDER BY id'),
    accounts: await rows('SELECT id, balance FROM accounts WHERE profile_id = ? ORDER BY id'),
    transactions: await rows(
      'SELECT id, amount FROM transactions WHERE profile_id = ? ORDER BY id'
    ),
  };
}

/** The account's own row: its address and how it signs in. */
export async function accountRow(id: number) {
  return env.DB.prepare(
    'SELECT email, password_hash, email_verified, auth_provider, provider_id, token_version FROM users WHERE id = ?'
  )
    .bind(id)
    .first<{
      email: string | null;
      password_hash: string | null;
      email_verified: number;
      auth_provider: string;
      provider_id: string | null;
      token_version: number;
    }>();
}

/**
 * Whether `password` is account `id`'s password now. A sign-in cannot tell a test that for an
 * account waiting for its confirm link: it answers a right password there as a wrong one.
 */
export async function passwordIs(id: number, password = PASSWORD): Promise<boolean> {
  const hash = (await accountRow(id))?.password_hash;
  return !!hash && (await verifyPassword(password, hash));
}

/** The account's rows in every access table, as they stand. */
export async function accessRows(id: number): Promise<AccessRows> {
  const rows = {} as AccessRows;
  for (const table of ACCESS_TABLES) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM ${table} WHERE user_id = ? ORDER BY rowid`
    )
      .bind(id)
      .all<Record<string, unknown>>();
    rows[table] = results;
  }
  return rows;
}

/**
 * Remove the accounts `users` selects (SQL that yields user ids), with their data and every
 * access row. Scoped, because the suite shares one database and other files' rows point at their
 * own users.
 */
export async function removeAccounts(users: string): Promise<void> {
  const profiles = `SELECT id FROM profiles WHERE user_id IN (${users})`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM transactions WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM accounts WHERE profile_id IN (${profiles})`),
    env.DB.prepare(`DELETE FROM profiles WHERE user_id IN (${users})`),
    ...ACCESS_TABLES.map((table) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE user_id IN (${users})`)
    ),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${users})`),
  ]);
}

export function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** Sign in with a password: the one seedAccount set, unless another is given. */
export const signIn = (email: string, password = PASSWORD) =>
  post('/api/auth/login', { email, password });

export const me = (cookie: string) =>
  SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } });

/** A read of the app's own data, which a session of an account waiting for its link is refused. */
export const profilesWith = (cookie: string) =>
  SELF.fetch('https://example.com/api/profiles', { headers: { Cookie: cookie } });

/** A call to the MCP server, which takes an API token. */
export const callMcp = (token: string) =>
  SELF.fetch('https://example.com/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

/** The session cookie a response sets, ready to send back, or null. */
export function sessionFrom(res: Response): string | null {
  for (const set of res.headers.getSetCookie()) {
    const pair = set.split(';')[0]!;
    if (pair.startsWith('fm_session=') && pair.length > 'fm_session='.length) return pair;
  }
  return null;
}
