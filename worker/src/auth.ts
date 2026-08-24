// Zero-dependency auth for Cloudflare Workers, adapted from the mercurypitch
// db-worker module. Built entirely on WebCrypto + a D1 handle, so the core is
// portable — it can be lifted into a shared cross-app auth library later.
//
// Differences from mercurypitch (chosen for a finance app):
//   - the JWT lives in an httpOnly, Secure, SameSite=Lax COOKIE, not localStorage
//     + Authorization header (not XSS-exfiltratable; the OAuth callback can
//     Set-Cookie then 302 to a clean URL, no #fragment hand-off).
//   - shorter token TTL (7 days).
//   - integer user ids (matches the existing schema + profiles.user_id).
//
// Strategy: stateless JWT (HS256) + Google Sign-In (server-side code flow with a
// signed-state CSRF guard). Logout / "sign out everywhere" via a token_version
// counter on the user row.

import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from './index';
import { logAuthEvent } from './authlog';

const encoder = new TextEncoder();

export const SESSION_COOKIE = 'fm_session';
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
// Cloudflare Workers' WebCrypto rejects PBKDF2 with more than 100,000 iterations
// ("iteration counts above 100000 are not supported"), so this is the runtime ceiling — a
// higher value (e.g. OWASP's 600k) makes hashPassword/verify throw at runtime. Do not raise it
// without moving to a KDF the Workers runtime supports at higher cost (e.g. Argon2id via WASM).
const PBKDF2_ITERATIONS = 100_000;

// ── base64url ────────────────────────────────────────────────────────────────
function b64urlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ── JWT (HS256) ──────────────────────────────────────────────────────────────
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

interface JwtPayload {
  sub: string; // user id (stringified integer)
  provider: string; // 'google' | 'password'
  iat: number;
  exp: number;
  v: number; // token_version, for revocation
  sid?: string; // sessions.id — absent on tokens issued before the sessions table existed
}

async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = b64urlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data));
  return `${data}.${b64urlEncode(sig)}`;
}

async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  try {
    // b64urlDecode can throw on a malformed cookie — keep it inside the try so a garbage
    // token fails closed to null (→ 401), never an unhandled 500.
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      b64urlDecode(sig),
      encoder.encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as JwtPayload;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Passwords (PBKDF2-SHA256) — for native email/password accounts ────────────
// Stored as `pbkdf2$<iterations>$<salt>$<hash>`. The iteration count lives in the string so a
// stored hash is self-describing: raising PBKDF2_ITERATIONS later needs no data migration.
async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(bits)}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iters, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  // Verify with the iteration count embedded in the stored hash (self-describing format), so a
  // future change to PBKDF2_ITERATIONS never invalidates existing hashes.
  const bits = new Uint8Array(await pbkdf2(password, b64urlDecode(saltB64), Number(iters)));
  const expected = b64urlDecode(hashB64);
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i]! ^ expected[i]!;
  return diff === 0;
}

// ── Session cookie ────────────────────────────────────────────────────────────
function cookie(name: string, value: string, maxAgeSeconds: number, env: Env): string {
  const secure = env.APP_ENV !== 'development'; // local http dev can't send Secure cookies
  const attrs = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ];
  if (env.COOKIE_DOMAIN) attrs.push(`Domain=${env.COOKIE_DOMAIN}`);
  return attrs.filter(Boolean).join('; ');
}
export function clearedSessionCookie(env: Env): string {
  return cookie(SESSION_COOKIE, '', 0, env);
}
/**
 * EVERY value the request carries for this cookie name, in the order the browser sent them.
 *
 * Usually one. But cookie identity is (name, Domain, Path), not name alone, so one request can
 * legitimately carry several `fm_session` values — and does: prod issues its cookie on
 * `.tokencircles.com`, which domain-matches `api.dev.tokencircles.com`, so a browser that has
 * signed into both sends prod's cookie AND dev's to the dev API.
 *
 * The old version returned the FIRST match and stopped. RFC 6265 §5.4 sorts equal-Path cookies
 * oldest-first, so the first match is the STALEST one — which made this deterministic rather than
 * flaky: the dev API kept verifying prod's JWT, failed the token_version check against its own
 * database, and answered 401 to a user who had just logged in successfully. Signing in again
 * could not fix it, because the fresh cookie was appended behind the stale one. Only clearing
 * site data cleared it.
 */
function readCookies(request: Request, name: string): string[] {
  const header = request.headers.get('Cookie');
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) values.push(v.join('='));
  }
  return values;
}

/** What the device was, recorded once at sign-in so it can be shown back to the user later. */
export interface SessionOrigin {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Sign a JWT for the user and return a Set-Cookie value.
 *
 * Also records a `sessions` row and puts its id in the token, which is what makes one device
 * revocable without touching the others.
 */
export async function issueSessionCookie(
  userId: number,
  provider: string,
  env: Env,
  origin: SessionOrigin = {}
): Promise<string> {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET not configured');
  const row = await env.DB.prepare('SELECT token_version FROM users WHERE id = ?')
    .bind(userId)
    .first<{ token_version: number }>();
  const sid = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, provider, user_agent, ip) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(sid, userId, provider, origin.userAgent ?? null, origin.ip ?? null)
    .run();
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    {
      sub: String(userId),
      provider,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
      v: row?.token_version ?? 1,
      sid,
    },
    env.JWT_SECRET
  );
  return cookie(SESSION_COOKIE, token, TOKEN_TTL_SECONDS, env);
}

export interface AuthUser {
  userId: number;
  provider: string;
  /** Which device this is. Absent for a token issued before the sessions table existed. */
  sessionId?: string;
}

/**
 * How stale `last_seen_at` is allowed to get. Writing it on every request would put a D1 write in
 * front of every authenticated call for a column nobody reads more precisely than "today".
 */
const SESSION_TOUCH_SECONDS = 300;

/** Why a session was refused. Logged, never returned to the caller — see authlog.ts. */
export type AuthFailure =
  | 'not_configured'
  | 'no_cookie'
  | 'bad_token'
  | 'unknown_user'
  /** token_version moved past this token — "sign out everywhere". */
  | 'revoked'
  /** The token is fine; the device it belongs to was signed out. */
  | 'session_ended';

export interface AuthResult {
  user: AuthUser | null;
  reason?: AuthFailure;
  /**
   * How many session cookies the request carried. More than one means duplicates across Domain or
   * Path scopes — worth surfacing, because it is invisible from the outside and it is what turns
   * a working login into a permanent 401.
   */
  cookieCount: number;
}

/**
 * Portable core: verify the session cookie against the JWT secret + D1. No Hono dependency.
 *
 * Tries every session cookie on the request rather than only the first. One that fails is not
 * evidence the request is unauthenticated — it may simply be another deployment's cookie riding
 * along on a shared parent domain — so the first one that actually verifies wins, whatever order
 * the browser chose to send them in.
 */
export async function authenticateRequest(request: Request, env: Env): Promise<AuthResult> {
  if (!env.JWT_SECRET) return { user: null, reason: 'not_configured', cookieCount: 0 };
  const tokens = readCookies(request, SESSION_COOKIE);
  if (tokens.length === 0) return { user: null, reason: 'no_cookie', cookieCount: 0 };

  // Keep the most informative failure to report. A token that verified and was then revoked says
  // far more than one that was never ours to begin with.
  let reason: AuthFailure = 'bad_token';
  for (const token of tokens) {
    const payload = await verifyJwt(token, env.JWT_SECRET);
    if (!payload) continue;
    // Fail closed: the user must still exist, and a token whose version is below the
    // stored token_version was revoked (logout / "sign out everywhere").
    const user = await env.DB.prepare('SELECT token_version FROM users WHERE id = ?')
      .bind(Number(payload.sub))
      .first<{ token_version: number }>();
    if (!user) {
      if (reason === 'bad_token') reason = 'unknown_user';
      continue;
    }
    if (user.token_version > (payload.v ?? 0)) {
      reason = 'revoked';
      continue;
    }
    if (payload.sid !== undefined) {
      const session = await env.DB.prepare(
        'SELECT id, last_seen_at FROM auth_sessions WHERE id = ? AND user_id = ?'
      )
        .bind(payload.sid, Number(payload.sub))
        .first<{ id: string; last_seen_at: string }>();
      // The row is gone: this device was signed out, here or from the session list.
      if (!session) {
        reason = 'session_ended';
        continue;
      }
      // Conditional, so an idle-ish session costs one write every SESSION_TOUCH_SECONDS rather
      // than one per request. Fire-and-forget: a failed touch must never fail the request.
      void env.DB.prepare(
        `UPDATE auth_sessions SET last_seen_at = datetime('now')
         WHERE id = ? AND last_seen_at <= datetime('now', ?)`
      )
        .bind(payload.sid, `-${SESSION_TOUCH_SECONDS} seconds`)
        .run()
        .catch(() => undefined);
    }
    return {
      user: {
        userId: Number(payload.sub),
        provider: payload.provider,
        ...(payload.sid !== undefined ? { sessionId: payload.sid } : {}),
      },
      cookieCount: tokens.length,
    };
  }
  return { user: null, reason, cookieCount: tokens.length };
}

export async function getAuthFromRequest(request: Request, env: Env): Promise<AuthUser | null> {
  return (await authenticateRequest(request, env)).user;
}

/** Hono middleware: 401 unless authenticated; exposes the user id via c.get('userId'). */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await authenticateRequest(c.req.raw, c.env);
  if (!auth.user) {
    // A 401 is the one 4xx that can mean the SERVER is wrong, so unlike the other 4xx it is
    // recorded — with the reason, and with how many session cookies came in.
    logAuthEvent(c, {
      event: 'session',
      outcome: 'denied',
      reason: auth.reason,
      cookieCount: auth.cookieCount,
    });
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('userId', auth.user.userId);
  if (auth.user.sessionId !== undefined) c.set('sessionId', auth.user.sessionId);
  await next();
};

// ── Google Sign-In ────────────────────────────────────────────────────────────
export interface GoogleClaims {
  aud: string;
  sub: string;
  iss?: string;
  exp?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
}

/** Verify a Google id_token via the v3 tokeninfo endpoint and check the audience. */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string
): Promise<GoogleClaims | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken }),
  });
  if (!res.ok) return null;
  const claims = (await res.json()) as GoogleClaims;
  if (claims.aud !== clientId) return null; // critical: this token was minted for us
  // Defense in depth — tokeninfo already validates the token, but pin the issuer and expiry too.
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com')
    return null;
  if (claims.exp && Number(claims.exp) < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

// Signed, stateless OAuth `state` (CSRF + open-redirect guard). No server storage.
interface OAuthState {
  returnTo: string;
  ts: number;
}
export async function signState(state: OAuthState, secret: string): Promise<string> {
  const body = b64urlEncode(encoder.encode(JSON.stringify(state)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${b64urlEncode(sig)}`;
}
export async function verifyState(raw: string, secret: string): Promise<OAuthState | null> {
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    b64urlDecode(sig),
    encoder.encode(body)
  );
  if (!valid) return null;
  try {
    const state = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as OAuthState;
    if (typeof state.returnTo !== 'string' || typeof state.ts !== 'number') return null;
    if (Date.now() - state.ts > STATE_TTL_MS) return null;
    return state;
  } catch {
    return null;
  }
}

/** Allowlist for the post-login redirect target (open-redirect defense). */
export function isAllowedReturnTo(returnTo: string, env: Env): boolean {
  let origin: string;
  try {
    origin = new URL(returnTo).origin;
  } catch {
    return false;
  }
  const allowed = [
    'http://localhost:3800',
    'http://127.0.0.1:3800',
    ...(env.CORS_ORIGIN ? [env.CORS_ORIGIN] : []),
    ...(env.APP_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  return allowed.includes(origin);
}

/**
 * Find-or-create the user for a verified Google account. `created` is true only
 * for a brand-new account (the caller sends the welcome email then — matching
 * the email/password registration path); linking Google to an existing account
 * is not a new signup.
 */
export async function resolveGoogleUser(
  db: D1Database,
  claims: GoogleClaims
): Promise<{ userId: number; created: boolean; email: string | null }> {
  const byProvider = await db
    .prepare("SELECT id FROM users WHERE auth_provider = 'google' AND provider_id = ?")
    .bind(claims.sub)
    .first<{ id: number }>();
  if (byProvider) return { userId: byProvider.id, created: false, email: null };

  // Link to an existing account with the same verified email.
  if (claims.email && claims.email_verified === 'true') {
    const byEmail = await db
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(claims.email)
      .first<{ id: number }>();
    if (byEmail) {
      await db
        .prepare(
          "UPDATE users SET auth_provider = 'google', provider_id = ?, email_verified = 1 WHERE id = ?"
        )
        .bind(claims.sub, byEmail.id)
        .run();
      return { userId: byEmail.id, created: false, email: null };
    }
  }

  // New Google user. Store the email only if verified (avoids a UNIQUE(email) collision
  // with an existing account); username stays NULL for OAuth accounts.
  const verified = claims.email_verified === 'true';
  const res = await db
    .prepare(
      "INSERT INTO users (username, email, email_verified, auth_provider, provider_id) VALUES (NULL, ?, ?, 'google', ?)"
    )
    .bind(verified ? (claims.email ?? null) : null, verified ? 1 : 0, claims.sub)
    .run();
  const userId = res.meta.last_row_id as number;
  // Every user needs a default profile (the Express backend seeded one at bootstrap);
  // without it every profile-scoped route would 403 immediately after sign-up.
  await db
    .prepare('INSERT INTO profiles (name, user_id) VALUES (?, ?)')
    .bind('Personal Profile', userId)
    .run();
  return { userId, created: true, email: verified ? (claims.email ?? null) : null };
}
