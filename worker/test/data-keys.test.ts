/**
 * The key hierarchy (src/data-keys.ts) against the real local D1. The property that matters most
 * is the invariant in the module doc: once a user has a data key, a missing or wrong master key
 * is an error for reads AND writes — never a quiet fallback to plaintext.
 *
 * These construct their own env ({ DB, DATA_KEK_n }) rather than using the suite's, so they mean
 * the same thing whether or not the suite is running with TEST_DATA_KEK.
 */
import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DataKeyring,
  DataKeyUnavailableError,
  encryptionEnabled,
  encryptionStatus,
  kekVersions,
  rewrapStaleKeys,
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

async function versionOf(id: number): Promise<string | undefined> {
  return (await dekOf(id))?.split('.')[1];
}

/** Every other test file's keys in the shared D1, by user. */
async function othersKeys(): Promise<Map<number, string>> {
  const { results } = await env.DB.prepare(
    'SELECT id, dek_wrapped FROM users WHERE dek_wrapped IS NOT NULL AND id NOT IN (901, 902, 903)'
  ).all<{ id: number; dek_wrapped: string }>();
  return new Map(results.map((r) => [r.id, r.dek_wrapped]));
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

// The D1 is shared with every other test file. A key left here under DATA_KEK_2 or above would read
// as stranded to /api/health, and as stale to the backfill, in every file that runs after this one.
afterAll(async () => {
  await env.DB.prepare('DELETE FROM users WHERE id IN (901, 902, 903)').run();
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

describe('looking keys up', () => {
  /** env.DB, counting the queries that look a user's data key up. */
  function counting(): { DB: D1Database; lookups: () => number } {
    let n = 0;
    const DB = new Proxy(env.DB, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== 'prepare') return typeof value === 'function' ? value.bind(target) : value;
        return (sql: string) => {
          if (sql.startsWith('SELECT dek_wrapped FROM users')) n++;
          return target.prepare(sql);
        };
      },
    });
    return { DB, lookups: () => n };
  }

  it('with no master key, asks about a user once per request, not once per row written', async () => {
    const { DB, lookups } = counting();
    const ring = new DataKeyring({ DB });
    for (let row = 0; row < 3; row++) expect(await ring.forWrite(901)).toBeNull();
    expect(await ring.existing(901)).toBeNull();
    expect(lookups()).toBe(1);
  });

  it('with a master key, a user found to have no key still gets one on the first write', async () => {
    const ring = new DataKeyring({ DB: env.DB, DATA_KEK_1: K1 });
    expect(await ring.existing(901)).toBeNull();
    expect(await ring.forWrite(901)).not.toBeNull();
    expect(await dekOf(901)).not.toBeNull();
  });
});

describe('master key rotation', () => {
  // Versions no other test file uses. Every other file's key in the shared D1 is under DATA_KEK_1,
  // which these envs lack, so to them it is a key under a retired master key: counted as failed and
  // remaining, and never rewritten.
  const OLD = { DB: env.DB, DATA_KEK_4: K1 };
  const BOTH = { DB: env.DB, DATA_KEK_4: K1, DATA_KEK_5: K2 };
  const NEW = { DB: env.DB, DATA_KEK_5: K2 };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-wraps keys onto the newest master key, and what they sealed opens under it alone', async () => {
    const before = (await new DataKeyring(OLD).forWrite(901))!;
    await new DataKeyring(OLD).forWrite(902);
    const ctx = { ...CTX, userId: 901 };
    const sealed = await sealText(before, 'Groceries', ctx);
    const others = await othersKeys();

    expect(await rewrapStaleKeys(BOTH, { limit: 1000 })).toEqual({
      rewrapped: 2,
      failed: others.size,
      remaining: others.size,
    });
    expect([await versionOf(901), await versionOf(902)]).toEqual(['5', '5']);
    expect(await openText(await new DataKeyring(NEW).forRead(901), sealed, ctx)).toBe('Groceries');
    expect(await othersKeys()).toEqual(others);
  });

  it('has nothing to do while every key is under the newest master key', async () => {
    await new DataKeyring({ DB: env.DB, DATA_KEK_1: K1 }).forWrite(901);
    const none = { rewrapped: 0, failed: 0, remaining: 0 };
    expect(await rewrapStaleKeys({ DB: env.DB, DATA_KEK_1: K1 }, { limit: 1000 })).toEqual(none);
    expect(await rewrapStaleKeys({ DB: env.DB }, { limit: 1000 })).toEqual(none);
  });

  it('leaves a key it cannot open exactly as it was, and counts it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await new DataKeyring({ DB: env.DB, DATA_KEK_3: K1 }).forWrite(901); // its master key is gone
    await new DataKeyring({ DB: env.DB, DATA_KEK_4: K2 }).forWrite(902); // right version, wrong key
    await new DataKeyring(OLD).forWrite(903);
    const [k901, k902] = [await dekOf(901), await dekOf(902)];
    const others = await othersKeys();

    expect(await rewrapStaleKeys(BOTH, { limit: 1000 })).toEqual({
      rewrapped: 1,
      failed: others.size + 2,
      remaining: others.size + 2,
    });
    expect([await dekOf(901), await dekOf(902), await versionOf(903)]).toEqual([k901, k902, '5']);
  });

  it('stops at its limit without spending it on keys it cannot open, and resumes', async () => {
    await new DataKeyring({ DB: env.DB, DATA_KEK_3: K1 }).forWrite(901);
    await new DataKeyring(OLD).forWrite(902);
    await new DataKeyring(OLD).forWrite(903);
    expect((await rewrapStaleKeys(BOTH, { limit: 1 })).rewrapped).toBe(1);
    expect(await Promise.all([901, 902, 903].map(versionOf))).toEqual(['3', '5', '4']);
    expect((await rewrapStaleKeys(BOTH, { limit: 1 })).rewrapped).toBe(1);
    expect(await Promise.all([901, 902, 903].map(versionOf))).toEqual(['3', '5', '5']);
  });

  it('stops when its time is up', async () => {
    await new DataKeyring(OLD).forWrite(901);
    const stats = await rewrapStaleKeys(BOTH, { limit: 1000, outOfTime: () => true });
    expect(stats.rewrapped).toBe(0);
    expect(stats.remaining).toBeGreaterThan(0);
    expect(await versionOf(901)).toBe('4');
  });

  it('misses rather than overwrites a key that changed after it was read', async () => {
    const original = (await new DataKeyring(OLD).forWrite(901))!;
    // Another run overlapping this one re-wraps 901 between this run's read and its write.
    let raced = false;
    const racing = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') {
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (sql: string) => {
          const stmt = target.prepare(sql);
          if (!sql.startsWith('SELECT id, dek_wrapped FROM users')) return stmt;
          return {
            bind: (...params: unknown[]) => ({
              all: async () => {
                const read = await stmt.bind(...params).all<{ id: number }>();
                if (!raced && read.results.some((r) => r.id === 901)) {
                  raced = true;
                  await rewrapStaleKeys(BOTH, { limit: 1000 });
                }
                return read;
              },
            }),
          };
        };
      },
    });

    const stats = await rewrapStaleKeys({ ...BOTH, DB: racing }, { limit: 1000 });
    expect(raced).toBe(true);
    expect(stats.rewrapped).toBe(0);
    expect(await versionOf(901)).toBe('5');
    await interoperate(original, await new DataKeyring(NEW).forRead(901), 901);
  });

  it('makes /api/health say misconfigured while a key is under a master key that is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await new DataKeyring(OLD).forWrite(901);
    // Every other file's key is under DATA_KEK_1, so version 1 stays configured throughout.
    const before = { DB: env.DB, DATA_KEK_1: K1, DATA_KEK_4: K1 };
    const retiredTooEarly = { DB: env.DB, DATA_KEK_1: K1, DATA_KEK_5: K2 };
    expect(await encryptionStatus(before)).toBe('on');
    expect(await encryptionStatus(retiredTooEarly)).toBe('misconfigured');

    await rewrapStaleKeys({ ...before, DATA_KEK_5: K2 }, { limit: 1000 });
    expect(await encryptionStatus(retiredTooEarly)).toBe('on');

    await env.DB.prepare("UPDATE users SET dek_wrapped = 'not-a-key' WHERE id = 902").run();
    expect(await encryptionStatus(retiredTooEarly)).toBe('misconfigured');
  });
});
