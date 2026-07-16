// Thin async data-access helpers over D1 — the Worker analog of
// backend/repositories/baseRepo.js. D1 is SQLite, so the SQL is identical; only
// the API is async (prepare().bind().all()/first()/run()).
//
// Identifier validation mirrors the backend's _validateTable/_validateColumns so
// the same SQL-injection guard applies to any interpolated table/column names.

const IDENT = /^[a-zA-Z0-9_]+$/;

function assertIdent(name: string): void {
  if (!IDENT.test(name)) throw new Error(`Invalid identifier: ${name}`);
}

/**
 * Transient D1 failures worth retrying on a READ: the `d1 export` backup lock (see the
 * pre-migration backup in .github/workflows/deploy-worker.yml — "D1_ERROR: Currently processing a
 * long-running export"), plus connection blips and the storage reset a Worker code update causes.
 * Reads are idempotent, so retrying any of these just re-runs the same query once the blip clears.
 */
export function isTransientD1Error(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!msg) return false;
  return (
    isExportLock(msg) ||
    /Network connection lost/i.test(msg) ||
    /storage caused object to be reset/i.test(msg) ||
    /reset because its code was updated/i.test(msg)
  );
}

/**
 * The export lock specifically rejects a statement BEFORE it runs, so retrying is exactly-once
 * safe even for a WRITE. The other transient errors can strike after a write has committed but
 * before its response arrives, so retrying those on a write risks a duplicate — writes retry only
 * this one.
 */
function isExportLock(msg: string): boolean {
  return /long-running export/i.test(msg);
}

// Bounded backoff (~2s total) — long enough to ride out a small DB's export, short enough not to
// hold a request open. A longer lock falls through to the 503 mapping in index.ts.
const D1_RETRY_DELAYS_MS = [150, 300, 600, 1000];

async function withD1Retry<T>(
  op: () => Promise<T>,
  retriable: (err: unknown) => boolean = isTransientD1Error
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= D1_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (!retriable(err) || attempt === D1_RETRY_DELAYS_MS.length) break;
      await new Promise((resolve) => setTimeout(resolve, D1_RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
}

/** Retry predicate for writes — only the export lock (see isExportLock), never a mid-write blip. */
function isRetriableWriteError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return isExportLock(msg);
}

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const { results } = await withD1Retry(() =>
    db
      .prepare(sql)
      .bind(...params)
      .all<T>()
  );
  return results ?? [];
}

export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (
    (await withD1Retry(() =>
      db
        .prepare(sql)
        .bind(...params)
        .first<T>()
    )) ?? null
  );
}

/**
 * True when the given account id exists and belongs to `profileId`. Used to
 * reject client-supplied account_id / transfer_account_id values that reference
 * another user's account (IDOR guard). Rejects non-integer / non-positive ids
 * before touching the DB.
 */
export async function accountBelongsToProfile(
  db: D1Database,
  accountId: number,
  profileId: number
): Promise<boolean> {
  if (!Number.isInteger(accountId) || accountId <= 0) return false;
  const row = await first<{ id: number }>(
    db,
    'SELECT id FROM accounts WHERE id = ? AND profile_id = ?',
    accountId,
    profileId
  );
  return row !== null;
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  // Writes retry ONLY the export lock (rejected before commit) — see isRetriableWriteError.
  return withD1Retry(
    () =>
      db
        .prepare(sql)
        .bind(...params)
        .run(),
    isRetriableWriteError
  );
}

/** INSERT helper — validates table + column identifiers, parameterizes values. */
export async function insert(
  db: D1Database,
  table: string,
  data: Record<string, unknown>
): Promise<D1Result> {
  assertIdent(table);
  const keys = Object.keys(data);
  keys.forEach(assertIdent);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
  return run(db, sql, ...Object.values(data));
}

/** UPDATE helper — `where` is a required SQL fragment with ? placeholders. */
export async function update(
  db: D1Database,
  table: string,
  data: Record<string, unknown>,
  where: string,
  ...params: unknown[]
): Promise<D1Result> {
  assertIdent(table);
  const cols = Object.keys(data);
  cols.forEach(assertIdent);
  const sets = cols.map((k) => `${k} = ?`).join(', ');
  return run(db, `UPDATE ${table} SET ${sets} WHERE ${where}`, ...Object.values(data), ...params);
}

/** DELETE helper — `where` is required. */
export async function del(
  db: D1Database,
  table: string,
  where: string,
  ...params: unknown[]
): Promise<D1Result> {
  assertIdent(table);
  return run(db, `DELETE FROM ${table} WHERE ${where}`, ...params);
}
