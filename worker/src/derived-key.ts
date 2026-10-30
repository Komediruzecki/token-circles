/**
 * Signing keys derived from JWT_SECRET, one per use: HKDF-SHA256 with an empty salt and the use's
 * own label as the info. A value signed for one use (a login check, a sign-up marker) never
 * verifies as another, or as a session, an OAuth state or a capability, which sign with
 * JWT_SECRET itself. The label names the deployment (APP_ENV), so a value signed on one deployment
 * never verifies on another, even one given the same JWT_SECRET.
 */
const encoder = new TextEncoder();

/** The HMAC-SHA256 key for `label` on the deployment `appEnv` names. */
export async function derivedHmacKey(
  secret: string,
  label: string,
  appEnv: string | undefined
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode(`${label} env=${appEnv ?? ''}`),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify']
  );
}
