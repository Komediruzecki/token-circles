/**
 * The key hierarchy (src/data-keys.ts) against the real local D1. The property that matters most
 * is the invariant in the module doc: once a user has a data key, a missing or wrong master key
 * is an error for reads AND writes — never a quiet fallback to plaintext.
 *
 * These construct their own env ({ DB, DATA_KEK_n }) rather than using the suite's, so they mean
 * the same thing whether or not the suite is running with TEST_DATA_KEK.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DataKeyring,
  DataKeyUnavailableError,
  encryptionEnabled,
  encryptionStatus,
  kekVersions,
} from '../src/data-keys';
import { openText, sealText } from '../src/field-crypto';

function randomKek(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}
const K1 = randomKek();
const K2 = randomKek();
const CTX = { table: 'transactions', column: 'description', userId: 0 };

async function dekOf(id: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT dek_wrapped FROM users WHERE id = ?')
    .bind(id)
    .first<{ dek_wrapped: string | null }>();
  return row?.dek_wrapped ?? null;
}

/** A key works for a user iff what one ring seals, another ring opens. */
async function interoperate(a: CryptoKey, b: CryptoKey, userId: number): Promise<void> {
  const ctx = { ...CTX, userId };
  expect(await openText(b, await sealText(a, 'Groceries', ctx), ctx)).toBe('Groceries');
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM users WHERE id IN (901, 902, 903)').run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider) VALUES (901, 'k1@example.com', 'password')"
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider) VALUES (902, 'k2@example.com', 'password')"
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider) VALUES (903, 'k3@example.com', 'password')"
    ),
  ]);
});

describe('master key configuration', () => {
  it('finds configured versions by name and ignores empty ones', () => {
    expect(kekVersions({ DB: env.DB })).toEqual([]);
    expect(kekVersions({ DB: env.DB, DATA_KEK_1: K1, DATA_KEK_3: K2, DATA_KEK_2: ' ' })).toEqual([
      1, 3,
    ]);
    expect(encryptionEnabled({ DB: env.DB })).toBe(false);
    expect(encryptionEnabled({ DB: env.DB, DATA_KEK_1: K1 })).toBe(true);
  });

  it('reports off, on, and a key that will not import', async () => {
    // The shared D1 holds other files' keyed users, so 'off' is asked of a database with none.
    const noKeys = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    } as unknown as D1Database;
    expect(await encryptionStatus({ DB: noKeys })).toBe('off');
    expect(await encryptionStatus({ DB: env.DB, DATA_KEK_1: K1 })).toBe('on');
    expect(await encryptionStatus({ DB: env.DB, DATA_KEK_1: btoa('too short') })).toBe(
      'misconfigured'
    );
  });

  it('reports misconfigured, not off, when data is sealed and no master key is set', async () => {
    await new DataKeyring({ DB: env.DB, DATA_KEK_1: K1 }).forWrite(901);
    expect(await encryptionStatus({ DB: env.DB })).toBe('misconfigured');
  });

  it('reports unknown when the database does not answer the check', async () => {
    const down = {
      prepare: () => ({
        bind: () => ({
          first: async () => {
            throw new Error('D1 is down');
          },
        }),
      }),
    } as unknown as D1Database;
    expect(await encryptionStatus({ DB: down })).toBe('unknown');
  });

  it('refuses a malformed master key instead of writing plaintext', async () => {
    const ring = new DataKeyring({ DB: env.DB, DATA_KEK_1: btoa('too short') });
    await expect(ring.forWrite(901)).rejects.toBeInstanceOf(DataKeyUnavailableError);
    expect(await dekOf(901)).toBeNull();
  });
});

describe('data keys', () => {
  it('with no master key, creates nothing and says write plaintext', async () => {
    const ring = new DataKeyring({ DB: env.DB });
    expect(await ring.forWrite(901)).toBeNull();
    expect(await dekOf(901)).toBeNull();
  });

  it('creates one key on the first write and returns that same key to every later lookup', async () => {
    const E = { DB: env.DB, DATA_KEK_1: K1 };
    const created = await new DataKeyring(E).forWrite(901);
    expect(created).not.toBeNull();
    expect(await dekOf(901)).toMatch(/^dk1\.1\.[\w-]+\.[\w-]+$/);
    await interoperate(created!, await new DataKeyring(E).forRead(901), 901);
    await interoperate(created!, (await new DataKeyring(E).forWrite(901))!, 901);
  });

  it('wraps new keys under the highest master key and still opens keys under older ones', async () => {
    const old = await new DataKeyring({ DB: env.DB, DATA_KEK_1: K1 }).forWrite(901);
    const both = { DB: env.DB, DATA_KEK_1: K1, DATA_KEK_2: K2 };
    await interoperate(old!, await new DataKeyring(both).forRead(901), 901);
    await new DataKeyring(both).forWrite(902);
    expect(await dekOf(902)).toMatch(/^dk1\.2\./);
  });

  it('does not unwrap a key copied onto another user', async () => {
    const E = { DB: env.DB, DATA_KEK_1: K1 };
    await new DataKeyring(E).forWrite(901);
    await env.DB.prepare('UPDATE users SET dek_wrapped = ? WHERE id = 902')
      .bind(await dekOf(901))
      .run();
    await expect(new DataKeyring(E).forRead(902)).rejects.toBeInstanceOf(DataKeyUnavailableError);
  });

  it('once a user has a key, a missing master key fails reads AND writes — never plaintext', async () => {
    await new DataKeyring({ DB: env.DB, DATA_KEK_1: K1 }).forWrite(901);
    const unkeyed = new DataKeyring({ DB: env.DB });
    await expect(unkeyed.forWrite(901)).rejects.toBeInstanceOf(DataKeyUnavailableError);
    await expect(unkeyed.forRead(901)).rejects.toBeInstanceOf(DataKeyUnavailableError);
  });

  it('fails on the wrong master key rather than opening anything', async () => {
    await new DataKeyring({ DB: env.DB, DATA_KEK_1: K1 }).forWrite(901);
    await expect(
      new DataKeyring({ DB: env.DB, DATA_KEK_1: K2 }).forRead(901)
    ).rejects.toBeInstanceOf(DataKeyUnavailableError);
  });

  it('treats sealed rows for a user with no key on file as a fault', async () => {
    await expect(
      new DataKeyring({ DB: env.DB, DATA_KEK_1: K1 }).forRead(902)
    ).rejects.toBeInstanceOf(DataKeyUnavailableError);
  });

  it('settles two first writes racing on one key that both can use', async () => {
    const E = { DB: env.DB, DATA_KEK_1: K1 };
    const [a, b] = await Promise.all([
      new DataKeyring(E).forWrite(903),
      new DataKeyring(E).forWrite(903),
    ]);
    await interoperate(a!, b!, 903);
    await interoperate(b!, a!, 903);
    await interoperate(a!, await new DataKeyring(E).forRead(903), 903);
  });

  it('loses the key with the account: deleting the user leaves nothing to unwrap', async () => {
    const E = { DB: env.DB, DATA_KEK_1: K1 };
    await new DataKeyring(E).forWrite(901);
    await env.DB.prepare('DELETE FROM users WHERE id = 901').run();
    await expect(new DataKeyring(E).forRead(901)).rejects.toBeInstanceOf(DataKeyUnavailableError);
  });
});
