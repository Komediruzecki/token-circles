import { b64urlEncode, b64urlDecode, hmacKey } from './auth';

// Short-lived, single-purpose capability URLs, signed with JWT_SECRET using the same primitive
// as the OAuth state (signState/verifyState in auth.ts). Stateless by design: no table to write,
// no cron to sweep, and a leaked link stops working on its own.

export type SignedPurpose = 'import' | 'snapshot';
export const CAPABILITY_TTL_SECONDS = 900;

export interface Capability {
  tokenId: string;
  userId: number;
  profileId: number;
  purpose: SignedPurpose;
  exp: number; // unix seconds
}

const encoder = new TextEncoder();

export async function signCapability(
  cap: Omit<Capability, 'exp'>,
  secret: string,
  ttlSeconds: number = CAPABILITY_TTL_SECONDS
): Promise<string> {
  const payload: Capability = { ...cap, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${b64urlEncode(mac)}`;
}

/**
 * Verify, then check the purpose and the expiry.
 *
 * `purpose` is inside the signed payload, not just compared afterwards, so an import capability
 * can never be replayed against the snapshot route however the URL is rearranged.
 */
export async function verifyCapability(
  sig: string,
  purpose: SignedPurpose,
  secret: string
): Promise<Capability | null> {
  const dot = sig.indexOf('.');
  if (dot <= 0) return null;
  const body = sig.slice(0, dot);
  let mac: Uint8Array;
  try {
    mac = b64urlDecode(sig.slice(dot + 1));
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    mac as unknown as BufferSource,
    encoder.encode(body)
  );
  if (!ok) return null;

  let cap: Capability;
  try {
    cap = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as Capability;
  } catch {
    return null;
  }
  if (cap.purpose !== purpose) return null;
  if (!Number.isFinite(cap.exp) || cap.exp <= Math.floor(Date.now() / 1000)) return null;
  return cap;
}
