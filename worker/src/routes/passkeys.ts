/**
 * Passkeys (WebAuthn): register in Settings, sign in with one tap.
 *
 * Ceremony state rides in a short-lived signed httpOnly cookie (fm_webauthn) exactly like the
 * 2FA challenge: the server stays stateless between "here are your options" and "verify this".
 * A user-verified passkey (device PIN / biometric) is possession + inherence in one gesture, so
 * passkey login deliberately does NOT trigger the TOTP challenge — it already is MFA. That is
 * why user verification is REQUIRED on login, not preferred.
 *
 * RP identity: the frontend origin (CORS_ORIGIN), not the API host — passkeys are minted for
 * the domain the user sees. They do not transfer across preview domains.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { AppEnv, Env } from '../index';
import {
  b64urlDecode,
  b64urlEncode,
  cookie,
  hmacKey,
  issueSessionCookie,
  readCookies,
  requireAuth,
  verifyPassword,
} from '../auth';
import { verifySecondFactor } from './twofa';
import { logAuthEvent } from '../authlog';
import { clientIp, enforce } from '../ratelimit';

const RP_NAME = 'Token Circles';
export const WEBAUTHN_COOKIE = 'fm_webauthn';
const CHALLENGE_TTL_SECONDS = 300;

/**
 * The user-facing origin the passkey is bound to — never the API host. No configured origin
 * means no passkeys: falling back to the request URL would mint credentials bound to
 * api.<domain>, which every login from the app origin would then fail against, silently.
 */
function rpConfig(env: Env): { origin: string; id: string } | null {
  const origin = env.CORS_ORIGIN || env.APP_ORIGINS?.split(',')[0];
  if (!origin) return null;
  try {
    return { origin, id: new URL(origin).hostname };
  } catch {
    return null;
  }
}

// ── Signed ceremony-state cookie (same construction as the 2FA challenge) ────
interface CeremonyState {
  challenge: string;
  purpose: 'reg' | 'auth';
  /** Bound for registration: only the session that asked may answer. */
  userId?: number;
  exp: number;
}

async function hmacB64url(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  return b64urlEncode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

async function issueCeremonyCookie(state: Omit<CeremonyState, 'exp'>, env: Env): Promise<string> {
  if (!env.JWT_SECRET) throw new Error('Auth not configured');
  const full: CeremonyState = {
    ...state,
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
  };
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(full)));
  const token = `${payload}.${await hmacB64url(payload, env.JWT_SECRET)}`;
  return cookie(WEBAUTHN_COOKIE, token, CHALLENGE_TTL_SECONDS, env);
}

async function readCeremony(
  request: Request,
  env: Env,
  purpose: 'reg' | 'auth'
): Promise<CeremonyState | null> {
  if (!env.JWT_SECRET) return null;
  for (const raw of readCookies(request, WEBAUTHN_COOKIE)) {
    const [payload, mac] = raw.split('.');
    if (!payload || !mac) continue;
    const expected = await hmacB64url(payload, env.JWT_SECRET);
    if (mac.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) continue;
    try {
      const state = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as CeremonyState;
      if (state.purpose !== purpose) continue;
      if (!state.exp || state.exp < Math.floor(Date.now() / 1000)) continue;
      return state;
    } catch {
      continue;
    }
  }
  return null;
}

interface CredentialRow {
  id: string;
  user_id: number;
  public_key: string;
  counter: number;
  transports: string | null;
}

export const passkeyRoutes = new Hono<AppEnv>();

/** How recently a session must have been minted to add a passkey without re-proving identity. */
const FRESH_SESSION_MINUTES = 10;
const MAX_PASSKEYS_PER_USER = 10;

/**
 * Adding a passkey mints a credential that skips the TOTP challenge and survives password
 * resets and "sign out everywhere" — stronger than anything a bare session cookie proves. A
 * session fresh off a login (the post-login nudge) may add one directly; anything older must
 * re-present the password or a 2FA code, GitHub's sudo-mode rule.
 */
async function registrationAllowed(
  c: Context<AppEnv>,
  userId: number,
  reauth: string | undefined
): Promise<boolean> {
  const sessionId = c.get('sessionId');
  if (sessionId) {
    const fresh = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM auth_sessions
       WHERE id = ? AND user_id = ? AND created_at > datetime('now', '-${FRESH_SESSION_MINUTES} minutes')`
    )
      .bind(sessionId, userId)
      .first<{ ok: number }>();
    if (fresh) return true;
  }
  if (!reauth) return false;
  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(userId)
    .first<{ password_hash: string | null }>();
  if (user?.password_hash && (await verifyPassword(reauth, user.password_hash))) return true;
  // Google-only accounts have no password; a TOTP or recovery code proves the same thing.
  return verifySecondFactor(c, userId, reauth);
}

passkeyRoutes.post('/api/auth/passkeys/register/options', requireAuth, async (c) => {
  const userId = c.get('userId');
  const rp = rpConfig(c.env);
  if (!rp) return c.json({ error: 'Auth not configured' }, 500);
  const rl = await enforce(c, `passkey-reg:${userId}`, 20, 3600);
  if (rl) return rl;
  const body = (await c.req.json().catch(() => ({}))) as { reauth?: string };
  if (!(await registrationAllowed(c, userId, body.reauth?.trim() || undefined))) {
    logAuthEvent(c, { event: 'twofa', outcome: 'denied', reason: 'passkey_reg_reauth', userId });
    return c.json(
      { error: 'Confirm your password (or a 2FA code) to add a passkey', reauth: true },
      401
    );
  }
  const user = await c.env.DB.prepare('SELECT email, username FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string | null; username: string | null }>();
  const existing = await c.env.DB.prepare(
    'SELECT id, transports FROM webauthn_credentials WHERE user_id = ?'
  )
    .bind(userId)
    .all<{ id: string; transports: string | null }>();
  if (existing.results.length >= MAX_PASSKEYS_PER_USER) {
    // Unbounded rows would eventually overflow authenticators' excludeCredentials limits and
    // break the legitimate owner's own "add" button.
    return c.json({ error: 'Passkey limit reached — remove one you no longer use first' }, 400);
  }
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    // The copy pins the generic to Uint8Array<ArrayBuffer>, which simplewebauthn requires.
    userID: new Uint8Array(new TextEncoder().encode(String(userId))),
    userName: user?.email || user?.username || `user-${userId}`,
    attestationType: 'none',
    excludeCredentials: existing.results.map((row) => ({
      id: row.id,
      transports: row.transports ? (JSON.parse(row.transports) as never) : undefined,
    })),
    authenticatorSelection: {
      // Discoverable, so the login button works with no username typed first. UV required to
      // MATCH login: a verification-less credential would register fine and then never sign in.
      residentKey: 'required',
      userVerification: 'required',
    },
  });
  c.header(
    'Set-Cookie',
    await issueCeremonyCookie({ challenge: options.challenge, purpose: 'reg', userId }, c.env)
  );
  return c.json(options);
});

passkeyRoutes.post('/api/auth/passkeys/register/verify', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ceremony = await readCeremony(c.req.raw, c.env, 'reg');
  if (!ceremony || ceremony.userId !== userId) {
    return c.json({ error: 'Registration expired — try again' }, 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    response?: RegistrationResponseJSON;
    name?: string;
  };
  if (!body.response) return c.json({ error: 'Missing response' }, 400);
  const rp = rpConfig(c.env);
  if (!rp) return c.json({ error: 'Auth not configured' }, 500);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      // Mirrors login: a credential registered without user verification could never sign in.
      requireUserVerification: true,
    });
  } catch {
    verification = null;
  }
  if (!verification?.verified || !verification.registrationInfo) {
    return c.json({ error: 'That passkey could not be verified' }, 400);
  }
  const { credential, credentialBackedUp } = verification.registrationInfo;
  const name = (body.name ?? '').trim().slice(0, 60) || null;
  try {
    await c.env.DB.prepare(
      `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, transports, device_name, backed_up)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        credential.id,
        userId,
        b64urlEncode(credential.publicKey),
        credential.counter,
        credential.transports ? JSON.stringify(credential.transports) : null,
        name,
        credentialBackedUp ? 1 : 0
      )
      .run();
  } catch (err) {
    // The ceremony cookie lives 300s and a browser can double-submit; the credential id is the
    // primary key, so the second write must answer cleanly rather than leak a D1 error string.
    if (String(err).includes('UNIQUE')) {
      return c.json({ error: 'That passkey is already registered' }, 409);
    }
    throw err;
  }
  c.header('Set-Cookie', cookie(WEBAUTHN_COOKIE, '', 0, c.env));
  return c.json({ ok: true, id: credential.id, name });
});

passkeyRoutes.get('/api/auth/passkeys', requireAuth, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, device_name AS name, backed_up, created_at, last_used_at
     FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at`
  )
    .bind(c.get('userId'))
    .all();
  return c.json({ passkeys: rows.results });
});

passkeyRoutes.delete('/api/auth/passkeys/:id', requireAuth, async (c) => {
  const res = await c.env.DB.prepare(
    'DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?'
  )
    .bind(c.req.param('id'), c.get('userId'))
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// ── Login (no session yet) ────────────────────────────────────────────────────

passkeyRoutes.post('/api/auth/passkeys/login/options', async (c) => {
  // Roomier than the verify bucket: conditional UI fires one options call per login-screen
  // load, so an office behind one IP burns these without anyone clicking anything.
  const rl = await enforce(c, `passkey-options-ip:${clientIp(c)}`, 60, 900);
  if (rl) return rl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const rp = rpConfig(c.env);
  if (!rp) return c.json({ error: 'Auth not configured' }, 500);
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    // Required, not preferred: UV is what lets a passkey stand in for password + TOTP.
    userVerification: 'required',
  });
  c.header(
    'Set-Cookie',
    await issueCeremonyCookie({ challenge: options.challenge, purpose: 'auth' }, c.env)
  );
  return c.json(options);
});

passkeyRoutes.post('/api/auth/passkeys/login/verify', async (c) => {
  const rl = await enforce(c, `passkey-verify-ip:${clientIp(c)}`, 30, 900);
  if (rl) return rl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const ceremony = await readCeremony(c.req.raw, c.env, 'auth');
  if (!ceremony) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'passkey_challenge_missing' });
    return c.json({ error: 'Sign-in expired — try again' }, 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as { response?: AuthenticationResponseJSON };
  if (!body.response?.rawId) return c.json({ error: 'Missing response' }, 400);

  const row = await c.env.DB.prepare('SELECT * FROM webauthn_credentials WHERE id = ?')
    .bind(body.response.rawId)
    .first<CredentialRow>();
  if (!row) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'passkey_unknown' });
    return c.json({ error: 'That passkey is not registered here' }, 401);
  }
  const rp = rpConfig(c.env);
  if (!rp) return c.json({ error: 'Auth not configured' }, 500);
  let verification;
  let counterRegressed = false;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: row.id,
        publicKey: new Uint8Array(b64urlDecode(row.public_key)),
        counter: row.counter,
        transports: row.transports ? (JSON.parse(row.transports) as never) : undefined,
      },
      requireUserVerification: true,
    });
  } catch (err) {
    // A signature counter that runs backwards is the one signal that a credential may have
    // been CLONED — it must be distinguishable in auth_logs from an ordinary bad signature.
    counterRegressed = String(err).toLowerCase().includes('counter');
    verification = null;
  }
  if (!verification?.verified) {
    logAuthEvent(c, {
      event: 'login',
      outcome: 'denied',
      reason: counterRegressed ? 'passkey_counter_regression' : 'passkey_failed',
      userId: row.user_id,
    });
    return c.json({ error: 'That passkey could not be verified' }, 401);
  }
  await c.env.DB.prepare(
    "UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime('now') WHERE id = ?"
  )
    .bind(verification.authenticationInfo.newCounter, row.id)
    .run();
  const user = await c.env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<{ id: number; email: string | null }>();
  if (!user) return c.json({ error: 'That passkey is not registered here' }, 401);
  // No TOTP challenge on purpose — a user-verified passkey is already two factors (see module doc).
  logAuthEvent(c, {
    event: 'login',
    outcome: 'ok',
    reason: 'passkey',
    userId: user.id,
    email: user.email,
  });
  c.header('Set-Cookie', cookie(WEBAUTHN_COOKIE, '', 0, c.env), { append: true });
  c.header(
    'Set-Cookie',
    await issueSessionCookie(user.id, 'passkey', c.env, {
      userAgent: c.req.header('user-agent') ?? null,
      ip: clientIp(c),
    }),
    { append: true }
  );
  return c.json({ id: user.id, email: user.email });
});
