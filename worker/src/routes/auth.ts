import { Hono } from 'hono'
import type { AppEnv } from '../index'
import {
  requireAuth,
  verifyGoogleIdToken,
  signState,
  verifyState,
  isAllowedReturnTo,
  resolveGoogleUser,
  issueSessionCookie,
  clearedSessionCookie,
} from '../auth'

// Google Sign-In (server-side code flow) + session endpoints. The token is set as
// an httpOnly cookie, so the browser never handles it directly.
export const authRoutes = new Hono<AppEnv>()

// 1) Kick off login: redirect to Google with a signed state carrying returnTo.
authRoutes.get('/api/auth/google/start', async (c) => {
  const { GOOGLE_CLIENT_ID, JWT_SECRET } = c.env
  if (!GOOGLE_CLIENT_ID || !JWT_SECRET) return c.json({ error: 'Google login not configured' }, 500)

  const url = new URL(c.req.url)
  const returnTo = url.searchParams.get('returnTo') || c.env.CORS_ORIGIN || url.origin
  if (!isAllowedReturnTo(returnTo, c.env)) return c.json({ error: 'Invalid returnTo' }, 400)

  const state = await signState({ returnTo, ts: Date.now() }, JWT_SECRET)
  const redirectUri = `${url.origin}/api/auth/google/callback`
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  auth.searchParams.set('redirect_uri', redirectUri)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', 'openid email profile')
  auth.searchParams.set('state', state)
  auth.searchParams.set('prompt', 'select_account')
  return c.redirect(auth.toString(), 302)
})

// 2) Google redirect target: exchange code, verify, set session cookie, go home.
authRoutes.get('/api/auth/google/callback', async (c) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET } = c.env
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !JWT_SECRET) {
    return c.json({ error: 'Google login not configured' }, 500)
  }
  const url = new URL(c.req.url)
  const code = url.searchParams.get('code')
  const rawState = url.searchParams.get('state')
  if (!code || !rawState) return c.json({ error: 'Missing code or state' }, 400)

  const state = await verifyState(rawState, JWT_SECRET)
  if (!state || !isAllowedReturnTo(state.returnTo, c.env)) return c.json({ error: 'Invalid state' }, 400)

  const redirectUri = `${url.origin}/api/auth/google/callback`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) return c.json({ error: 'Token exchange failed' }, 401)
  const tok = (await tokenRes.json()) as { id_token?: string }
  if (!tok.id_token) return c.json({ error: 'No id_token returned' }, 401)

  const claims = await verifyGoogleIdToken(tok.id_token, GOOGLE_CLIENT_ID)
  if (!claims) return c.json({ error: 'Invalid id_token' }, 401)

  const userId = await resolveGoogleUser(c.env.DB, claims)
  const sessionCookie = await issueSessionCookie(userId, 'google', c.env)
  // Build the redirect explicitly so the Set-Cookie is guaranteed to ride along.
  return new Response(null, {
    status: 302,
    headers: { Location: state.returnTo, 'Set-Cookie': sessionCookie },
  })
})

// Current user.
authRoutes.get('/api/auth/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const user = await c.env.DB.prepare(
    'SELECT id, username, email, auth_provider FROM users WHERE id = ?'
  )
    .bind(userId)
    .first()
  return c.json(user)
})

// Logout everywhere: bump token_version (revokes all issued JWTs) and clear the cookie.
authRoutes.post('/api/auth/logout', requireAuth, async (c) => {
  const userId = c.get('userId')
  await c.env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(userId).run()
  c.header('Set-Cookie', clearedSessionCookie(c.env))
  return c.json({ ok: true })
})
