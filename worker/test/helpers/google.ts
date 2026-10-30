/**
 * Google sign-in the way a browser runs it: the start route answers with Google's address, whose
 * `state` the callback gets back, and a cookie that this browser sends to the callback.
 */
import { SELF } from 'cloudflare:test';

export const GOOGLE_STATE_COOKIE = 'fm_google_state';

export interface GoogleStart {
  /** The `state` the start route sent to Google. */
  state: string;
  /** The start route's cookie as the browser sends it back (`name=value`), or null. */
  cookie: string | null;
  /** The start route's whole Set-Cookie line for that cookie, or null. */
  setCookie: string | null;
}

/** Open the start route with `returnTo`, as the app's Continue with Google does. */
export async function startGoogleSignIn(returnTo: string): Promise<GoogleStart> {
  const res = await SELF.fetch(
    `https://example.com/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`,
    { redirect: 'manual' }
  );
  if (res.status !== 302) throw new Error(`Google start answered ${res.status}`);
  const state = new URL(res.headers.get('Location')!).searchParams.get('state');
  if (!state) throw new Error('Google start sent no state');
  const setCookie =
    res.headers.getSetCookie().find((line) => line.startsWith(`${GOOGLE_STATE_COOKIE}=`)) ?? null;
  return { state, setCookie, cookie: setCookie ? setCookie.split(';')[0]! : null };
}

/** Arrive at the callback the way Google's redirect does, with `cookie` if one is given. */
export function googleCallback(
  state: string,
  cookie?: string | null,
  code: string | null = 'test-code'
): Promise<Response> {
  const query = new URLSearchParams({ state });
  if (code !== null) query.set('code', code);
  return SELF.fetch(`https://example.com/api/auth/google/callback?${query}`, {
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

/** A whole Google sign-in in one browser: start, then the callback with the start's cookie. */
export async function googleSignInFromStart(returnTo: string): Promise<Response> {
  const { state, cookie } = await startGoogleSignIn(returnTo);
  return googleCallback(state, cookie);
}
