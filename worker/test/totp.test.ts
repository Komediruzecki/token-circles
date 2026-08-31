/**
 * TOTP (RFC 6238) + base32 (RFC 4648) unit tests.
 *
 * The 6-digit expectations are the RFC 6238 Appendix B reference vectors (SHA-1, ASCII secret
 * "12345678901234567890"), truncated from the published 8-digit values.
 */
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  currentStep,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  verifyTotp,
} from '../src/totp';

const ASCII_SECRET = new TextEncoder().encode('12345678901234567890');
const ASCII_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32 (RFC 4648)', () => {
  it('encodes the RFC 6238 reference secret', () => {
    expect(base32Encode(ASCII_SECRET)).toBe(ASCII_SECRET_B32);
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255, 128, 64, 32, 7]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('decodes lowercase and ignores spaces (user-typed keys)', () => {
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toEqual(ASCII_SECRET);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('GEZ1')).toThrow(); // '1' is not in RFC 4648 base32
  });
});

describe('totpCode (RFC 6238 Appendix B vectors, SHA-1, 6 digits)', () => {
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];
  for (const [t, expected] of vectors) {
    it(`T=${t} -> ${expected}`, async () => {
      const step = Math.floor(t / 30);
      expect(await totpCode(ASCII_SECRET_B32, step)).toBe(expected);
    });
  }
});

describe('currentStep', () => {
  it('is unix time divided by the 30s period', () => {
    expect(currentStep(59_000)).toBe(1);
    expect(currentStep(1_111_111_109_000)).toBe(37037036);
  });
});

describe('verifyTotp', () => {
  const NOW = 1_111_111_109_000; // step 37037036, code 081804

  it('accepts the current-step code and returns the matched step', async () => {
    expect(await verifyTotp(ASCII_SECRET_B32, '081804', { nowMs: NOW })).toBe(37037036);
  });

  it('accepts one step of clock drift in both directions', async () => {
    const prev = await totpCode(ASCII_SECRET_B32, 37037035);
    const next = await totpCode(ASCII_SECRET_B32, 37037037);
    expect(await verifyTotp(ASCII_SECRET_B32, prev, { nowMs: NOW })).toBe(37037035);
    expect(await verifyTotp(ASCII_SECRET_B32, next, { nowMs: NOW })).toBe(37037037);
  });

  it('rejects a code from two steps away', async () => {
    const stale = await totpCode(ASCII_SECRET_B32, 37037034);
    expect(await verifyTotp(ASCII_SECRET_B32, stale, { nowMs: NOW })).toBeNull();
  });

  it('rejects a replayed code at or below minStep (anti-replay)', async () => {
    expect(
      await verifyTotp(ASCII_SECRET_B32, '081804', { nowMs: NOW, minStep: 37037037 })
    ).toBeNull();
    expect(await verifyTotp(ASCII_SECRET_B32, '081804', { nowMs: NOW, minStep: 37037036 })).toBe(
      37037036
    );
  });

  it('rejects garbage input without throwing', async () => {
    expect(await verifyTotp(ASCII_SECRET_B32, '', { nowMs: NOW })).toBeNull();
    expect(await verifyTotp(ASCII_SECRET_B32, 'abcdef', { nowMs: NOW })).toBeNull();
    expect(await verifyTotp(ASCII_SECRET_B32, '12345', { nowMs: NOW })).toBeNull();
  });
});

describe('generateTotpSecret', () => {
  it('produces 32 base32 chars (20 bytes) and unique values', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(a).not.toBe(b);
    expect(base32Decode(a).length).toBe(20);
  });
});

describe('otpauthUri', () => {
  it('builds a scannable otpauth URI with issuer and escaped label', () => {
    const uri = otpauthUri(ASCII_SECRET_B32, 'user@example.com', 'Token Circles');
    expect(uri).toBe(
      'otpauth://totp/Token%20Circles:user%40example.com' +
        `?secret=${ASCII_SECRET_B32}&issuer=Token%20Circles&algorithm=SHA1&digits=6&period=30`
    );
  });
});
