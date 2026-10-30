/**
 * The sign-up marker: what lets the confirm link sign in the browser that signed up, with no
 * password asked (GET /api/auth/verify-email).
 *
 * A password sign-up leaves its browser an HttpOnly cookie on this API host, sent only to the
 * confirm link's route. Opened in that browser while the marker lasts, the account's confirm link
 * confirms the address and signs in. Anywhere else, or later, the link asks for the password, as
 * it always has.
 *
 * - Every sign-up the route takes sets it the same way, whether or not the address had an account,
 *   so the answer says nothing about the address. Its value holds neither the address nor anything
 *   from the password.
 * - It signs the address as the sign-up typed it and the password hash that sign-up computed,
 *   which has to be the account's stored hash, byte for byte. So it signs in only the browser that
 *   set the account's current password: the same proof that a password sign-in where the link was
 *   opened gives (email-link.ts). A sign-up with another password at an address that already
 *   waits never stored its hash, and a new password since means a new hash, so neither marker
 *   signs in.
 * - It lasts CONFIRM_LINK_SIGN_IN.seconds (shared/confirmLinkSignIn.ts), which also says whether
 *   the confirm link signs in this way at all. A test holds it to no longer than the link lasts.
 * - It is signed with a key of its own (derived-key.ts), so a session, a login check or an
 *   email-link marker never verifies as one, and a marker left on one deployment never verifies
 *   on another.
 * - Everything else fails closed: a marker that ran out, was changed, names another address or
 *   another password, or cannot be read signs in nothing, and the link asks for the password.
 */
import type { Env } from './index';
import { b64urlDecode, b64urlEncode, readCookies } from './auth';
import { derivedHmacKey } from './derived-key';
import { CONFIRM_LINK_SIGN_IN } from '../../shared/confirmLinkSignIn';

export const SIGNUP_MARKER_COOKIE = 'fm_signup';
/** The one route that reads it, the confirm link's. A cookie's Path is a prefix of the route's. */
export const SIGNUP_MARKER_PATH = '/api/auth/verify-email';
/** How long a sign-up marker lasts, from the sign-up. */
export const SIGNUP_MARKER_SECONDS = CONFIRM_LINK_SIGN_IN.seconds;
/** How many markers of one request are looked at. A browser holds one; each costs a verify. */
const SIGNUP_MARKERS_READ = 3;
const FORMAT = 'v1';
/** The HKDF label of the key, so the key signs sign-up markers and nothing else. */
const KEY_LABEL = 'token-circles signup-marker v1';

const encoder = new TextEncoder();
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** What a marker signs. Exported so a test can sign the same bytes with another key. */
export function signupMarkerBytes(
  exp: number,
  id: string,
  address: string,
  passwordHash: string
): Uint8Array {
  return encoder.encode(JSON.stringify(['signup-marker', FORMAT, exp, id, address, passwordHash]));
}

function signupMarkerKey(env: Env): Promise<CryptoKey> {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET not configured');
  return derivedHmacKey(env.JWT_SECRET, KEY_LABEL, env.APP_ENV);
}

function markerCookie(value: string, maxAgeSeconds: number, env: Env): string {
  // Host-only (no Domain), and sent to the confirm link's route alone.
  const secure = env.APP_ENV !== 'development'; // local http dev can't send Secure cookies
  return [
    `${SIGNUP_MARKER_COOKIE}=${value}`,
    `Path=${SIGNUP_MARKER_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * The Set-Cookie that leaves a sign-up's marker in its browser, for `address` and the password
 * hash the sign-up computed. Null when the confirm link does not sign in this way
 * (CONFIRM_LINK_SIGN_IN.sameBrowser).
 */
export async function signupMarker(
  env: Env,
  address: string,
  passwordHash: string
): Promise<string | null> {
  if (!CONFIRM_LINK_SIGN_IN.sameBrowser) return null;
  const exp = nowSeconds() + SIGNUP_MARKER_SECONDS;
  const id = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const mac = await crypto.subtle.sign(
    'HMAC',
    await signupMarkerKey(env),
    signupMarkerBytes(exp, id, address, passwordHash)
  );
  return markerCookie(`${FORMAT}.${exp}.${id}.${b64urlEncode(mac)}`, SIGNUP_MARKER_SECONDS, env);
}

/** The Set-Cookie that removes the marker. */
export function clearedSignupMarker(env: Env): string {
  return markerCookie('', 0, env);
}

/** Whether the request carries a sign-up marker at all, good or not. */
export function carriesSignupMarker(request: Request): boolean {
  return readCookies(request, SIGNUP_MARKER_COOKIE).some((v) => v !== '');
}

/**
 * Whether the request carries a good marker for `address` and `passwordHash`: one this
 * deployment signed, not run out, for that address and that password hash.
 */
export async function signupMarkerFor(
  request: Request,
  env: Env,
  address: string,
  passwordHash: string
): Promise<boolean> {
  if (!CONFIRM_LINK_SIGN_IN.sameBrowser || !env.JWT_SECRET) return false;
  const values = readCookies(request, SIGNUP_MARKER_COOKIE).filter((v) => v !== '');
  if (values.length === 0) return false;
  const key = await signupMarkerKey(env);
  const now = nowSeconds();
  for (const value of values.slice(0, SIGNUP_MARKERS_READ)) {
    const [format, expPart, id, macPart, ...rest] = value.split('.');
    if (rest.length > 0 || format !== FORMAT || !expPart || !id || !macPart) continue;
    if (!/^[0-9]{1,12}$/.test(expPart)) continue;
    const exp = Number(expPart);
    // Run out, or longer than any marker lasts, which no marker this Worker left can be.
    if (exp <= now || exp > now + SIGNUP_MARKER_SECONDS) continue;
    if (!/^[A-Za-z0-9_-]{22}$/.test(id)) continue;
    let mac: Uint8Array;
    try {
      mac = b64urlDecode(macPart);
    } catch {
      continue;
    }
    const bytes = signupMarkerBytes(exp, id, address, passwordHash);
    if (await crypto.subtle.verify('HMAC', key, mac, bytes)) return true;
  }
  return false;
}
