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

import type { MiddlewareHandler } from 'hono'
import type { AppEnv, Env } from './index'

const encoder = new TextEncoder()

export const SESSION_COOKIE = 'fm_session'
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const PBKDF2_ITERATIONS = 100_000

// ── base64url ────────────────────────────────────────────────────────────────
function b64urlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

// ── JWT (HS256) ──────────────────────────────────────────────────────────────
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

interface JwtPayload {
  sub: string // user id (stringified integer)
  provider: string // 'google' | 'password'
  iat: number
  exp: number
  v: number // token_version, for revocation
}

async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = b64urlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)))
  const data = `${header}.${body}`
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data))
  return `${data}.${b64urlEncode(sig)}`
}

async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  try {
    // b64urlDecode can throw on a malformed cookie — keep it inside the try so a garbage
    // token fails closed to null (→ 401), never an unhandled 500.
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      b64urlDecode(sig),
      encoder.encode(`${header}.${body}`)
    )
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as JwtPayload
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ── Passwords (PBKDF2-SHA256) — for native email/password accounts ────────────
// Existing accounts in the Express backend use bcrypt, which can't run on
// Workers; re-hash to this format on next successful login, or migrate offline.
async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(bits)}`
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iters, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'pbkdf2') return false
  const bits = new Uint8Array(await pbkdf2(password, b64urlDecode(saltB64), Number(iters)))
  const expected = b64urlDecode(hashB64)
  if (bits.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < bits.length; i++) diff |= bits[i]! ^ expected[i]!
  return diff === 0
}

// ── Session cookie ────────────────────────────────────────────────────────────
function cookie(name: string, value: string, maxAgeSeconds: number, env: Env): string {
  const secure = env.APP_ENV !== 'development' // local http dev can't send Secure cookies
  const attrs = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ]
  if (env.COOKIE_DOMAIN) attrs.push(`Domain=${env.COOKIE_DOMAIN}`)
  return attrs.filter(Boolean).join('; ')
}
export function clearedSessionCookie(env: Env): string {
  return cookie(SESSION_COOKIE, '', 0, env)
}
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

/** Sign a JWT for the user (reading their current token_version) and return a Set-Cookie value. */
export async function issueSessionCookie(userId: number, provider: string, env: Env): Promise<string> {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET not configured')
  const row = await env.DB.prepare('SELECT token_version FROM users WHERE id = ?')
    .bind(userId)
    .first<{ token_version: number }>()
  const now = Math.floor(Date.now() / 1000)
  const token = await signJwt(
    { sub: String(userId), provider, iat: now, exp: now + TOKEN_TTL_SECONDS, v: row?.token_version ?? 1 },
    env.JWT_SECRET
  )
  return cookie(SESSION_COOKIE, token, TOKEN_TTL_SECONDS, env)
}

export interface AuthUser {
  userId: number
  provider: string
}

/** Portable core: verify the session cookie against the JWT secret + D1. No Hono dependency. */
export async function getAuthFromRequest(request: Request, env: Env): Promise<AuthUser | null> {
  if (!env.JWT_SECRET) return null
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null
  const payload = await verifyJwt(token, env.JWT_SECRET)
  if (!payload) return null
  // Fail closed: the user must still exist, and a token whose version is below the
  // stored token_version was revoked (logout / "sign out everywhere").
  const user = await env.DB.prepare('SELECT token_version FROM users WHERE id = ?')
    .bind(Number(payload.sub))
    .first<{ token_version: number }>()
  if (!user) return null
  if (user.token_version > (payload.v ?? 0)) return null
  return { userId: Number(payload.sub), provider: payload.provider }
}

/** Hono middleware: 401 unless authenticated; exposes the user id via c.get('userId'). */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = await getAuthFromRequest(c.req.raw, c.env)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  c.set('userId', auth.userId)
  await next()
}

// ── Google Sign-In ────────────────────────────────────────────────────────────
export interface GoogleClaims {
  aud: string
  sub: string
  iss?: string
  exp?: string
  email?: string
  email_verified?: string
  name?: string
  picture?: string
}

/** Verify a Google id_token via the v3 tokeninfo endpoint and check the audience. */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleClaims | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken }),
  })
  if (!res.ok) return null
  const claims = (await res.json()) as GoogleClaims
  if (claims.aud !== clientId) return null // critical: this token was minted for us
  // Defense in depth — tokeninfo already validates the token, but pin the issuer and expiry too.
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com')
    return null
  if (claims.exp && Number(claims.exp) < Math.floor(Date.now() / 1000)) return null
  return claims
}

// Signed, stateless OAuth `state` (CSRF + open-redirect guard). No server storage.
interface OAuthState {
  returnTo: string
  ts: number
}
export async function signState(state: OAuthState, secret: string): Promise<string> {
  const body = b64urlEncode(encoder.encode(JSON.stringify(state)))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body))
  return `${body}.${b64urlEncode(sig)}`
}
export async function verifyState(raw: string, secret: string): Promise<OAuthState | null> {
  const [body, sig] = raw.split('.')
  if (!body || !sig) return null
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), encoder.encode(body))
  if (!valid) return null
  try {
    const state = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as OAuthState
    if (typeof state.returnTo !== 'string' || typeof state.ts !== 'number') return null
    if (Date.now() - state.ts > STATE_TTL_MS) return null
    return state
  } catch {
    return null
  }
}

/** Allowlist for the post-login redirect target (open-redirect defense). */
export function isAllowedReturnTo(returnTo: string, env: Env): boolean {
  let origin: string
  try {
    origin = new URL(returnTo).origin
  } catch {
    return false
  }
  const allowed = [
    'http://localhost:3800',
    'http://127.0.0.1:3800',
    ...(env.CORS_ORIGIN ? [env.CORS_ORIGIN] : []),
    ...(env.APP_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ]
  return allowed.includes(origin)
}

/** Find-or-create the user for a verified Google account; returns the integer user id. */
export async function resolveGoogleUser(db: D1Database, claims: GoogleClaims): Promise<number> {
  const byProvider = await db
    .prepare("SELECT id FROM users WHERE auth_provider = 'google' AND provider_id = ?")
    .bind(claims.sub)
    .first<{ id: number }>()
  if (byProvider) return byProvider.id

  // Link to an existing account with the same verified email.
  if (claims.email && claims.email_verified === 'true') {
    const byEmail = await db.prepare('SELECT id FROM users WHERE email = ?').bind(claims.email).first<{ id: number }>()
    if (byEmail) {
      await db
        .prepare("UPDATE users SET auth_provider = 'google', provider_id = ?, email_verified = 1 WHERE id = ?")
        .bind(claims.sub, byEmail.id)
        .run()
      return byEmail.id
    }
  }

  // New Google user. Store the email only if verified (avoids a UNIQUE(email) collision
  // with an existing account); username stays NULL for OAuth accounts.
  const verified = claims.email_verified === 'true'
  const res = await db
    .prepare(
      "INSERT INTO users (username, email, email_verified, auth_provider, provider_id) VALUES (NULL, ?, ?, 'google', ?)"
    )
    .bind(verified ? (claims.email ?? null) : null, verified ? 1 : 0, claims.sub)
    .run()
  const userId = res.meta.last_row_id as number
  // Every user needs a default profile (the Express backend seeded one at bootstrap);
  // without it every profile-scoped route would 403 immediately after sign-up.
  await db.prepare('INSERT INTO profiles (name, user_id) VALUES (?, ?)').bind('Personal Profile', userId).run()
  return userId
}
