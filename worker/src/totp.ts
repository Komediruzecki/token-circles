/**
 * TOTP (RFC 6238) over WebCrypto, plus the RFC 4648 base32 codec authenticator apps expect.
 *
 * SHA-1 / 6 digits / 30s on purpose: it is what Google Authenticator, Aegis, 1Password et al.
 * assume when scanning an otpauth URI, and RFC 6238's HMAC construction is not affected by
 * SHA-1 collision attacks.
 */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Tolerates what people paste: lowercase, spaces, trailing `=` padding. */
export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 20 random bytes (RFC 4226 recommended minimum is 16) as 32 base32 chars. */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function currentStep(nowMs = Date.now(), periodSeconds = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / periodSeconds);
}

/** HOTP (RFC 4226) at a given counter — TOTP is HOTP with counter = time step. */
export async function totpCode(
  secretB32: string,
  step: number,
  digits = TOTP_DIGITS
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secretB32),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  // 8-byte big-endian counter. Steps stay far below 2^53, so two 32-bit writes suffice.
  const counter = new ArrayBuffer(8);
  const view = new DataView(counter);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** No early exit: a leaked mismatch position must not narrow the guess space. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyTotpOptions {
  nowMs?: number;
  /** Accepted clock drift in steps on each side. 1 = the RFC's recommended one-step window. */
  drift?: number;
  /** Lowest step still accepted. Pass last-used-step + 1 to make each code single-use. */
  minStep?: number;
}

/**
 * Returns the matched step so the caller can persist it for anti-replay, or null.
 * Every candidate in the window is compared (no early exit) to keep timing flat.
 */
export async function verifyTotp(
  secretB32: string,
  code: string,
  opts: VerifyTotpOptions = {}
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const drift = opts.drift ?? 1;
  const now = currentStep(opts.nowMs ?? Date.now());
  let matched: number | null = null;
  for (let step = now - drift; step <= now + drift; step++) {
    if (step < 0 || (opts.minStep !== undefined && step < opts.minStep)) continue;
    const candidate = await totpCode(secretB32, step);
    if (constantTimeEqual(candidate, code) && matched === null) matched = step;
  }
  return matched;
}

/** The QR payload authenticator apps scan. Label convention: `issuer:account`. */
export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return (
    `otpauth://totp/${label}?secret=${secretB32}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}` +
    `&period=${TOTP_PERIOD_SECONDS}`
  );
}
