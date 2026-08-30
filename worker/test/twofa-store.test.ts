/**
 * 2FA storage layer: TOTP secret encryption at rest, enrollment lifecycle, recovery codes.
 * Runs against the real D1 schema (migration 0028) in workerd.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  confirmTotp,
  consumeRecoveryCode,
  decryptTotpSecret,
  disableTotp,
  encryptTotpSecret,
  enrollTotp,
  generateRecoveryCodes,
  getTotpForLogin,
  markTotpStepUsed,
  storeRecoveryCodes,
  totpStatus,
} from '../src/twofa';

const SECRET_KEY = 'test-jwt-secret-not-for-prod'; // JWT_SECRET binding from vitest.config

describe('TOTP secret encryption at rest', () => {
  it('round-trips and never emits the same ciphertext twice (fresh IV)', async () => {
    const a = await encryptTotpSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', SECRET_KEY);
    const b = await encryptTotpSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', SECRET_KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain('GEZDGNBV');
    expect(await decryptTotpSecret(a, SECRET_KEY)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('returns null on tamper or wrong key instead of throwing', async () => {
    const enc = await encryptTotpSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', SECRET_KEY);
    expect(await decryptTotpSecret(enc, 'a-different-secret')).toBeNull();
    const tampered = enc.slice(0, -2) + (enc.endsWith('AA') ? 'BB' : 'AA');
    expect(await decryptTotpSecret(tampered, SECRET_KEY)).toBeNull();
  });
});

describe('recovery codes', () => {
  it('generates 10 unique codes shaped XXXXX-XXXXX', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(new Set(codes).size).toBe(10);
  });
});

describe('enrollment lifecycle (D1)', () => {
  let userId: number;

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM totp_credentials').run();
    await env.DB.prepare('DELETE FROM recovery_codes').run();
    await env.DB.prepare('DELETE FROM users').run();
    const res = await env.DB.prepare(
      "INSERT INTO users (email, password_hash, auth_provider) VALUES ('t@example.com', 'x', 'password')"
    ).run();
    userId = res.meta.last_row_id as number;
  });

  it('enroll stores an unconfirmed secret; status stays disabled until confirmed', async () => {
    await enrollTotp(env, userId, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(await totpStatus(env, userId)).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    expect(await getTotpForLogin(env, userId)).toBeNull(); // login must not challenge yet

    await confirmTotp(env, userId);
    expect((await totpStatus(env, userId)).enabled).toBe(true);
    const cred = await getTotpForLogin(env, userId);
    expect(cred?.secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(cred?.lastUsedStep).toBeNull();
  });

  it('re-enrolling before confirmation replaces the pending secret', async () => {
    await enrollTotp(env, userId, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    await enrollTotp(env, userId, 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U');
    await confirmTotp(env, userId);
    expect((await getTotpForLogin(env, userId))?.secret).toBe('MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U');
  });

  it('markTotpStepUsed persists the anti-replay high-water mark', async () => {
    await enrollTotp(env, userId, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    await confirmTotp(env, userId);
    await markTotpStepUsed(env, userId, 37037036);
    expect((await getTotpForLogin(env, userId))?.lastUsedStep).toBe(37037036);
  });

  it('recovery codes: consume works exactly once, wrong codes fail, count tracks', async () => {
    await enrollTotp(env, userId, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    await confirmTotp(env, userId);
    const codes = generateRecoveryCodes();
    await storeRecoveryCodes(env, userId, codes);
    expect((await totpStatus(env, userId)).recoveryCodesLeft).toBe(10);

    expect(await consumeRecoveryCode(env, userId, codes[3])).toBe(true);
    expect(await consumeRecoveryCode(env, userId, codes[3])).toBe(false); // spent
    expect(await consumeRecoveryCode(env, userId, 'AAAAA-AAAAA')).toBe(false);
    // Case/spacing tolerance: users retype these from paper.
    expect(await consumeRecoveryCode(env, userId, codes[4].toLowerCase())).toBe(true);
    expect((await totpStatus(env, userId)).recoveryCodesLeft).toBe(8);
  });

  it('storing a fresh batch of recovery codes invalidates the old batch', async () => {
    await enrollTotp(env, userId, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    await confirmTotp(env, userId);
    const first = generateRecoveryCodes();
    await storeRecoveryCodes(env, userId, first);
    const second = generateRecoveryCodes();
    await storeRecoveryCodes(env, userId, second);
    expect(await consumeRecoveryCode(env, userId, first[0])).toBe(false);
    expect(await consumeRecoveryCode(env, userId, second[0])).toBe(true);
    expect((await totpStatus(env, userId)).recoveryCodesLeft).toBe(9);
  });

  it('disable removes the credential and all recovery codes', async () => {
    await enrollTotp(env, userId, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    await confirmTotp(env, userId);
    await storeRecoveryCodes(env, userId, generateRecoveryCodes());
    await disableTotp(env, userId);
    expect(await totpStatus(env, userId)).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    expect(await getTotpForLogin(env, userId)).toBeNull();
  });

  it('a corrupted secret (e.g. rotated JWT_SECRET) fails CLOSED: challenge stays, secret null', async () => {
    await enrollTotp(env, userId, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    await confirmTotp(env, userId);
    await env.DB.prepare('UPDATE totp_credentials SET secret_enc = ? WHERE user_id = ?')
      .bind('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', userId)
      .run();
    // The row is confirmed, so login must still demand a second factor — the user gets in with
    // a recovery code (hashed, unaffected by key rotation), never with password alone.
    const cred = await getTotpForLogin(env, userId);
    expect(cred).not.toBeNull();
    expect(cred?.secret).toBeNull();
  });
});
