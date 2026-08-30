/**
 * A minimal software FIDO2 authenticator (ES256, attestation "none") so passkey tests can run
 * REAL registration and authentication ceremonies against the worker — no mocks, the same bytes
 * a platform authenticator would produce.
 */

const enc = new TextEncoder();

export function b64url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Tiny CBOR writer (just what an attestation object needs) ──────────────────
function cborUint(n: number, major: number): Uint8Array {
  const m = major << 5;
  if (n < 24) return new Uint8Array([m | n]);
  if (n < 256) return new Uint8Array([m | 24, n]);
  const out = new Uint8Array(3);
  out[0] = m | 25;
  new DataView(out.buffer).setUint16(1, n);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
type CborValue = number | string | Uint8Array | Map<number | string, CborValue>;
function cbor(value: CborValue): Uint8Array {
  if (typeof value === 'number') {
    if (value >= 0) return cborUint(value, 0);
    return cborUint(-value - 1, 1); // negative int
  }
  if (typeof value === 'string')
    return concat(cborUint(enc.encode(value).length, 3), enc.encode(value));
  if (value instanceof Uint8Array) return concat(cborUint(value.length, 2), value);
  const entries = [...value.entries()];
  return concat(cborUint(entries.length, 5), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]));
}

// ── ECDSA raw (r||s) -> ASN.1 DER, which is what WebAuthn signatures use ─────
function derEncodeSignature(raw: Uint8Array): Uint8Array {
  const derInt = (bytes: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0]! & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const r = derInt(raw.slice(0, 32));
  const s = derInt(raw.slice(32));
  return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

export interface SoftwareAuthenticator {
  credentialId: Uint8Array;
  register(
    challengeB64url: string,
    origin: string,
    rpId: string,
    opts?: { userVerified?: boolean }
  ): Promise<RegistrationResponseJSONish>;
  authenticate(
    challengeB64url: string,
    origin: string,
    rpId: string,
    opts?: { counter?: number; userVerified?: boolean }
  ): Promise<AuthenticationResponseJSONish>;
}

export interface RegistrationResponseJSONish {
  id: string;
  rawId: string;
  type: 'public-key';
  clientExtensionResults: Record<string, never>;
  response: { clientDataJSON: string; attestationObject: string; transports: string[] };
}
export interface AuthenticationResponseJSONish {
  id: string;
  rawId: string;
  type: 'public-key';
  clientExtensionResults: Record<string, never>;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
}

export async function createAuthenticator(): Promise<SoftwareAuthenticator> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)); // 0x04||x||y
  const x = rawPub.slice(1, 33);
  const y = rawPub.slice(33, 65);
  const credentialId = crypto.getRandomValues(new Uint8Array(32));

  // COSE_Key (EC2/ES256): {1: 2, 3: -7, -1: 1, -2: x, -3: y}
  const coseKey = cbor(
    new Map<number, CborValue>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, x],
      [-3, y],
    ])
  );

  const authDataFor = async (rpId: string, flags: number, counter: number, attested: boolean) => {
    const rpIdHash = await sha256(enc.encode(rpId));
    const head = new Uint8Array(37);
    head.set(rpIdHash, 0);
    head[32] = flags;
    new DataView(head.buffer).setUint32(33, counter);
    if (!attested) return head;
    const credLen = new Uint8Array(2);
    new DataView(credLen.buffer).setUint16(0, credentialId.length);
    return concat(head, new Uint8Array(16), credLen, credentialId, coseKey); // AAGUID = zeros
  };

  // A real authenticator's signature counter climbs on every use; tracking it here means a
  // test can sign in repeatedly without tripping the library's clone detection.
  let signCount = 0;

  return {
    credentialId,
    async register(challengeB64url, origin, rpId, opts = {}) {
      const clientData = enc.encode(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: challengeB64url,
          origin,
          crossOrigin: false,
        })
      );
      // UP | AT, plus UV unless the test wants a verification-less authenticator.
      const flags = 0x41 | (opts.userVerified === false ? 0 : 0x04);
      const authData = await authDataFor(rpId, flags, 0, true);
      const attestationObject = cbor(
        new Map<string, CborValue>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ])
      );
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64url(clientData),
          attestationObject: b64url(attestationObject),
          transports: ['internal'],
        },
      };
    },
    async authenticate(challengeB64url, origin, rpId, opts = {}) {
      const clientData = enc.encode(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: challengeB64url,
          origin,
          crossOrigin: false,
        })
      );
      const flags = 0x01 | (opts.userVerified === false ? 0 : 0x04); // UP, UV unless disabled
      const authData = await authDataFor(rpId, flags, opts.counter ?? ++signCount, false);
      const toSign = concat(authData, await sha256(clientData));
      const rawSig = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keys.privateKey,
          toSign as BufferSource
        )
      );
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64url(clientData),
          authenticatorData: b64url(authData),
          signature: b64url(derEncodeSignature(rawSig)),
          userHandle: null,
        },
      };
    },
  };
}
