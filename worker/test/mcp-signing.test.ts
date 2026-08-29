/**
 * Capability URLs carry their own authority so the model can curl a file without ever holding
 * the long-lived token. Each one is bound to a purpose and an expiry, and both must hold.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signCapability, verifyCapability } from '../src/signed-url';

const SECRET = 'test-jwt-secret-not-for-prod';
const base = { tokenId: 't-1', userId: 4242, profileId: 7 } as const;

describe('capability signatures', () => {
  it('round-trips a valid capability', async () => {
    const sig = await signCapability({ ...base, purpose: 'import' }, SECRET);
    const cap = await verifyCapability(sig, 'import', SECRET);
    expect(cap).toMatchObject({ ...base, purpose: 'import' });
    expect(cap?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a signature minted for a different purpose', async () => {
    const sig = await signCapability({ ...base, purpose: 'import' }, SECRET);
    expect(await verifyCapability(sig, 'snapshot', SECRET)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const sig = await signCapability({ ...base, purpose: 'import' }, SECRET);
    const [payload, mac] = sig.split('.');
    const decoded = JSON.parse(atob(payload!.replace(/-/g, '+').replace(/_/g, '/')));
    decoded.profileId = 999;
    const forged = btoa(JSON.stringify(decoded))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyCapability(`${forged}.${mac}`, 'import', SECRET)).toBeNull();
  });

  it('rejects an expired capability and a wrong secret', async () => {
    const expired = await signCapability({ ...base, purpose: 'import' }, SECRET, -10);
    expect(await verifyCapability(expired, 'import', SECRET)).toBeNull();

    const sig = await signCapability({ ...base, purpose: 'import' }, SECRET);
    expect(await verifyCapability(sig, 'import', 'a-different-secret')).toBeNull();
  });

  it("is usable with the worker's own JWT_SECRET binding", async () => {
    const secret = (env as unknown as { JWT_SECRET: string }).JWT_SECRET;
    const sig = await signCapability({ ...base, purpose: 'snapshot' }, secret);
    expect(await verifyCapability(sig, 'snapshot', secret)).not.toBeNull();
  });
});
