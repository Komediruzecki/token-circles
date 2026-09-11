/**
 * Per-user data keys, wrapped by a master key from Workers Secrets.
 *
 * Hierarchy (docs/plans/field-encryption.md):
 *   DATA_KEK_<n>        Workers Secret, base64 of 32 random bytes, and one per environment —
 *                       local, dev and prod never share one. The highest <n> wraps new keys;
 *                       lower ones stay configured through a rotation so existing keys unwrap.
 *   users.dek_wrapped   This user's data key, AES-256-GCM-wrapped under a master key, bound to
 *                       the user id by additional data: `dk1.<n>.<b64url iv>.<b64url ct>`.
 *
 * Deliberately independent of JWT_SECRET. twofa.ts derives its key from JWT_SECRET, so rotating
 * the auth secret orphans every TOTP secret — survivable there, because recovery codes are hashed
 * rather than encrypted. Here the same coupling would orphan everyone's transaction history.
 *
 * The invariant the rest of the design rests on: a user's rows are only ever sealed once that
 * user has a dek_wrapped, and from then on a missing or wrong master key is a hard error for reads
 * AND writes. Nothing silently falls back to writing plaintext for a user whose data is sealed.
 */
import { b64urlDecode, b64urlEncode } from './auth';
import * as db from './db';

export interface KeyEnv {
  DB: D1Database;
  [kek: `DATA_KEK_${number}`]: string | undefined;
}

// Probed by name rather than by enumerating env, which is not guaranteed to be a plain object.
const MAX_KEK_VERSION = 32;
const DEK_PREFIX = 'dk1';
const utf8 = new TextEncoder();

/**
 * The key that opens a user's data cannot be produced: the master key is missing or wrong, or the
 * stored key is damaged. A configuration fault — never a reason to fall back to plaintext. The
 * client sees a generic 503; the specifics go to the log, since they name key versions.
 */
export class DataKeyUnavailableError extends Error {
  statusCode = 503;
  constructor(readonly detail: string) {
    super('Encrypted data is temporarily unavailable.');
    this.name = 'DataKeyUnavailableError';
    console.error(`[data-keys] ${detail}`);
  }
}

function kekName(version: number): `DATA_KEK_${number}` {
  return `DATA_KEK_${version}` as `DATA_KEK_${number}`;
}

/** Versions of the master keys this environment has, ascending. Empty means encryption is off. */
export function kekVersions(env: KeyEnv): number[] {
  const versions: number[] = [];
  for (let v = 1; v <= MAX_KEK_VERSION; v++) {
    const material = env[kekName(v)];
    if (typeof material === 'string' && material.trim() !== '') versions.push(v);
  }
  return versions;
}

export function encryptionEnabled(env: KeyEnv): boolean {
  return kekVersions(env).length > 0;
}

// Keyed by the secret itself: the same material always imports to the same key, and a value that
// fails to import fails the same way every time.
const kekCache = new Map<string, Promise<CryptoKey>>();

function kekFor(env: KeyEnv, version: number): Promise<CryptoKey> {
  const material = (env[kekName(version)] ?? '').trim();
  let pending = kekCache.get(material);
  if (!pending) {
    pending = (async () => {
      let raw: Uint8Array;
      try {
        raw = b64urlDecode(material.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
      } catch {
        throw new DataKeyUnavailableError(`${kekName(version)} is not valid base64`);
      }
      if (raw.length !== 32) {
        throw new DataKeyUnavailableError(
          `${kekName(version)} must be base64 of exactly 32 bytes (it decodes to ${raw.length})`
        );
      }
      return crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt',
      ]);
    })();
    kekCache.set(material, pending);
  }
  return pending;
}

/**
 * A WHERE term matching a wrapped key under none of `versions`, a malformed one included, written
 * as ranges on idx_users_dek_wrapped rather than a parse of every row: `dk1.<n>.…` sorts inside
 * [`dk1.<n>.`, `dk1.<n>/`), '/' being the byte after '.', and no two versions' ranges overlap.
 * NULL (no key yet) matches nothing. `versions` must not be empty.
 */
function notUnder(versions: number[]): { sql: string; params: string[] } {
  const ranges = versions
    .map((v) => [`${DEK_PREFIX}.${v}.`, `${DEK_PREFIX}.${v}/`])
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const terms = ['dek_wrapped < ?'];
  const params = [ranges[0][0]];
  for (let i = 1; i < ranges.length; i++) {
    terms.push('(dek_wrapped >= ? AND dek_wrapped < ?)');
    params.push(ranges[i - 1][1], ranges[i][0]);
  }
  terms.push('dek_wrapped >= ?');
  params.push(ranges[ranges.length - 1][1]);
  return { sql: `(${terms.join(' OR ')})`, params };
}

/**
 * For /api/health: whether this deployment seals, and whether every configured key is usable.
 * No master key is only 'off' while nobody holds a data key. Once anyone does, their data is sealed
 * and every read of it is failing, which is the state this check exists to catch — a deleted or
 * dropped secret must not read like a deployment that never had one. For the same reason a data
 * key wrapped under a master version that is no longer configured is 'misconfigured': it is what
 * retiring the old key before the re-wrap finished looks like.
 */
export async function encryptionStatus(
  env: KeyEnv
): Promise<'off' | 'on' | 'misconfigured' | 'unknown'> {
  const versions = kekVersions(env);
  if (versions.length === 0) {
    try {
      const sealed = await db.first<{ one: number }>(
        env.DB,
        'SELECT 1 AS one FROM users WHERE dek_wrapped IS NOT NULL LIMIT 1'
      );
      return sealed ? 'misconfigured' : 'off';
    } catch {
      return 'unknown'; // a D1 blip is not a verdict on the keys
    }
  }
  try {
    await Promise.all(versions.map((v) => kekFor(env, v)));
  } catch {
    return 'misconfigured';
  }
  try {
    const outside = notUnder(versions);
    const stranded = await db.first<{ one: number }>(
      env.DB,
      `SELECT 1 AS one FROM users WHERE ${outside.sql} LIMIT 1`,
      ...outside.params
    );
    return stranded ? 'misconfigured' : 'on';
  } catch {
    return 'unknown';
  }
}

function dekAad(userId: number, version: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(utf8.encode(`dk1|u${userId}|k${version}`));
}

async function importDek(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function wrapDek(env: KeyEnv, raw: Uint8Array<ArrayBuffer>, userId: number): Promise<string> {
  const versions = kekVersions(env);
  const version = versions[versions.length - 1];
  const kek = await kekFor(env, version);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: dekAad(userId, version) },
    kek,
    raw
  );
  return `${DEK_PREFIX}.${version}.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

/**
 * The master-key version a wrapped key names — `dk1.<n>.<iv>.<ct>`, with n written as wrapDek
 * writes it — or null for a value that is not a wrapped key at all.
 */
function wrappedVersion(wrapped: string): number | null {
  const parts = wrapped.split('.');
  const version = Number(parts[1]);
  const wellFormed =
    parts.length === 4 &&
    parts[0] === DEK_PREFIX &&
    String(version) === parts[1] &&
    version >= 1 &&
    version <= MAX_KEK_VERSION;
  return wellFormed ? version : null;
}

async function unwrapRaw(
  env: KeyEnv,
  wrapped: string,
  userId: number
): Promise<Uint8Array<ArrayBuffer>> {
  const parts = wrapped.split('.');
  const version = wrappedVersion(wrapped);
  if (version === null) {
    throw new DataKeyUnavailableError(`user ${userId}: users.dek_wrapped is malformed`);
  }
  if (!env[kekName(version)]?.trim()) {
    throw new DataKeyUnavailableError(
      `user ${userId}: key is wrapped under ${kekName(version)}, which is not configured`
    );
  }
  const kek = await kekFor(env, version);
  let raw: ArrayBuffer;
  try {
    raw = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(b64urlDecode(parts[2])),
        additionalData: dekAad(userId, version),
      },
      kek,
      new Uint8Array(b64urlDecode(parts[3]))
    );
  } catch {
    throw new DataKeyUnavailableError(
      `user ${userId}: key does not unwrap under ${kekName(version)} — the wrong master key, or a key copied from another user`
    );
  }
  if (raw.byteLength !== 32) {
    throw new DataKeyUnavailableError(`user ${userId}: unwrapped key has the wrong length`);
  }
  return new Uint8Array(raw);
}

async function unwrapDek(env: KeyEnv, wrapped: string, userId: number): Promise<CryptoKey> {
  return importDek(await unwrapRaw(env, wrapped, userId));
}

export interface RewrapStats {
  /** Keys moved onto the newest master key this run. */
  rewrapped: number;
  /** Keys that could not be: their master key is no longer configured, or they do not unwrap. */
  failed: number;
  /** Keys not under the newest master key after the run. Zero is when an older one can go. */
  remaining: number;
}

const REWRAP_PAGE = 50;

/**
 * Master-key rotation: re-wrap every data key that is not under the newest DATA_KEK_<n> with it,
 * so an older one can be removed. The data keys themselves do not change, so nothing sealed is
 * touched — only users.dek_wrapped, by compare-and-set against the value read: anything that
 * changed it meanwhile makes the write miss rather than be overwritten. A key that cannot be
 * re-wrapped is counted and passed over (keyset pagination) and does not count against `limit`.
 */
export async function rewrapStaleKeys(
  env: KeyEnv,
  opts: { limit: number; outOfTime?: () => boolean }
): Promise<RewrapStats> {
  const stats: RewrapStats = { rewrapped: 0, failed: 0, remaining: 0 };
  const versions = kekVersions(env);
  if (versions.length === 0) return stats;
  const stale = notUnder([versions[versions.length - 1]]);
  const countStale = async (): Promise<number> =>
    (
      await db.first<{ n: number }>(
        env.DB,
        `SELECT COUNT(*) AS n FROM users WHERE ${stale.sql}`,
        ...stale.params
      )
    )?.n ?? 0;
  // Every run between rotations: one index lookup that finds nothing.
  if ((await countStale()) === 0) return stats;

  let afterId = 0;
  let left = opts.limit;
  while (left > 0 && !opts.outOfTime?.()) {
    const rows = await db.all<{ id: number; dek_wrapped: string }>(
      env.DB,
      `SELECT id, dek_wrapped FROM users WHERE ${stale.sql} AND id > ? ORDER BY id LIMIT ?`,
      ...stale.params,
      afterId,
      Math.min(REWRAP_PAGE, left)
    );
    if (rows.length === 0) break;
    afterId = rows[rows.length - 1].id;
    const writes: D1PreparedStatement[] = [];
    for (const row of rows) {
      // Under a master key this deployment no longer has, there is nothing to unwrap it with.
      // Counted without trying, so a key retired too early is one number in the log rather than
      // an error line per user on every run. A damaged key goes on to unwrapRaw, which names its
      // user in the log: putting an old master key back would not mend it.
      const version = wrappedVersion(row.dek_wrapped);
      if (version !== null && !versions.includes(version)) {
        stats.failed++;
        continue;
      }
      try {
        const raw = await unwrapRaw(env, row.dek_wrapped, row.id);
        writes.push(
          env.DB.prepare('UPDATE users SET dek_wrapped = ? WHERE id = ? AND dek_wrapped = ?').bind(
            await wrapDek(env, raw, row.id),
            row.id,
            row.dek_wrapped
          )
        );
      } catch (e) {
        if (!(e instanceof DataKeyUnavailableError)) throw e;
        stats.failed++;
      }
    }
    if (writes.length === 0) continue;
    left -= writes.length;
    const results = await db.batch(env.DB, writes);
    stats.rewrapped += results.filter((r) => (r.meta.changes ?? 0) === 1).length;
  }
  stats.remaining = await countStale();
  return stats;
}

/**
 * Resolves users' data keys, each at most once. Scope one to a request (keyringFor) or to one
 * cron invocation — never longer, so no key outlives the request that needed it: a module-level
 * cache would keep serving a deleted account's key, or a rotated one, for the life of the isolate.
 */
export class DataKeyring {
  private readonly keys = new Map<number, CryptoKey>();
  /** Users found to have no key while this deployment has no master key (see resolve). */
  private readonly keyless = new Set<number>();
  private readonly inflight = new Map<string, Promise<CryptoKey | null>>();

  constructor(readonly env: KeyEnv) {}

  get enabled(): boolean {
    return encryptionEnabled(this.env);
  }

  /** For rows whose marker says sealed. Never null: a sealed row with no key to open it is a fault. */
  async forRead(userId: number): Promise<CryptoKey> {
    const key = await this.resolve(userId, false);
    if (!key)
      throw new DataKeyUnavailableError(`user ${userId}: sealed rows but no data key on file`);
    return key;
  }

  /**
   * The user's key if they have one, null if they have none. Unlike forRead, "none" is an answer
   * here, not a fault; a key that exists but cannot be produced still throws.
   */
  async existing(userId: number): Promise<CryptoKey | null> {
    return this.resolve(userId, false);
  }

  /**
   * For writing. Creates the user's key on first use when this deployment has a master key.
   * Null means this deployment has no master key AND this user has no data key: write plaintext,
   * exactly as before encryption existed. A user who has a key always gets it, or an error —
   * whether or not the master key is still configured.
   */
  async forWrite(userId: number): Promise<CryptoKey | null> {
    return this.resolve(userId, this.enabled);
  }

  private resolve(userId: number, create: boolean): Promise<CryptoKey | null> {
    const known = this.keys.get(userId);
    if (known) return Promise.resolve(known);
    if (!create && this.keyless.has(userId)) return Promise.resolve(null);
    const slot = `${userId}:${create ? 'create' : 'read'}`;
    let pending = this.inflight.get(slot);
    if (!pending) {
      pending = this.load(userId, create)
        .then((key) => {
          if (key) this.keys.set(userId, key);
          // With no master key nothing here can give the user a key, so "none" holds for the rest
          // of the request — remembered, or a keyless import or restore asks D1 again for every
          // row it writes. With one, the next write creates the key, so "none" is never kept.
          else if (!this.enabled) this.keyless.add(userId);
          return key;
        })
        .finally(() => this.inflight.delete(slot));
      this.inflight.set(slot, pending);
    }
    return pending;
  }

  private async load(userId: number, create: boolean): Promise<CryptoKey | null> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new DataKeyUnavailableError(`not a user id: ${String(userId)}`);
    }
    const row = await db.first<{ dek_wrapped: string | null }>(
      this.env.DB,
      'SELECT dek_wrapped FROM users WHERE id = ?',
      userId
    );
    if (!row) throw new DataKeyUnavailableError(`user ${userId} does not exist`);
    if (row.dek_wrapped) return unwrapDek(this.env, row.dek_wrapped, userId);
    if (!create) return null;

    const raw = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapDek(this.env, raw, userId);
    // Compare-and-set. Two requests creating a first key at once must not both win, or whatever
    // was sealed under the loser's key would be unreadable for good; the loser adopts the winner's.
    // Also what makes a retried write safe: re-running it finds its own key already stored.
    const res = await db.run(
      this.env.DB,
      'UPDATE users SET dek_wrapped = ? WHERE id = ? AND dek_wrapped IS NULL',
      wrapped,
      userId
    );
    if ((res.meta.changes ?? 0) === 1) return importDek(raw);
    const winner = await db.first<{ dek_wrapped: string | null }>(
      this.env.DB,
      'SELECT dek_wrapped FROM users WHERE id = ?',
      userId
    );
    if (!winner?.dek_wrapped) {
      throw new DataKeyUnavailableError(`user ${userId}: key creation lost a race with no winner`);
    }
    return unwrapDek(this.env, winner.dek_wrapped, userId);
  }
}

// Keyed on the Request object, which is unique per invocation and dies with it.
const rings = new WeakMap<Request, DataKeyring>();

/** The keyring for this request: one lookup per user per request, gone when the request is. */
export function keyringFor(c: { env: KeyEnv; req: { raw: Request } }): DataKeyring {
  let ring = rings.get(c.req.raw);
  if (!ring) {
    ring = new DataKeyring(c.env);
    rings.set(c.req.raw, ring);
  }
  return ring;
}

/**
 * The user whose key seals a profile's rows. Null for a legacy profile with no owner, whose rows
 * therefore stay plaintext — there is nobody to hold the key.
 */
export async function profileOwner(DB: D1Database, profileId: number): Promise<number | null> {
  const row = await db.first<{ user_id: number | null }>(
    DB,
    'SELECT user_id FROM profiles WHERE id = ?',
    profileId
  );
  return row?.user_id ?? null;
}
