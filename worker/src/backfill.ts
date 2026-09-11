/**
 * The field-encryption backfill: seals rows and receipts stored before their owner had a key.
 *
 * It is the ONLY place an existing row changes form (text_enc 0 -> 1), and it does it by
 * compare-and-set against the exact values it read. A user edit landing in between makes the
 * write miss — the row is picked up again on a later run — instead of being overwritten with the
 * old text. Edits themselves (sealedUpdate) write in whatever form the row is in at that moment.
 *
 * Runs on its own trigger (BACKFILL_CRON) within a time and row budget, and simply resumes on the
 * next run. Without a master key it does nothing at all. Rows on a profile nobody owns
 * (profiles.user_id NULL — legacy data) have no key to be sealed under and stay plaintext.
 */
import * as db from './db';
import { DataKeyring, DataKeyUnavailableError, rewrapStaleKeys, type KeyEnv } from './data-keys';
import { sealField } from './field-crypto';
import { resealReceipt } from './sealed-objects';
import { changesOf, SEALED_COLUMNS, type SealedTable } from './sealed-rows';

export const BACKFILL_CRON = '*/20 * * * *';

export interface BackfillBudget {
  ms: number;
  rows: number;
  receipts: number;
  /** Data keys to move onto the newest master key per run (rotation); 1 000 when unset. */
  keys?: number;
}
// A cron run gets far more than this; the budget exists so one run is never the reason a
// scheduled invocation is killed. Every 20 minutes at 5 000 rows is 360 000 rows a day.
export const DEFAULT_BUDGET: BackfillBudget = { ms: 60_000, rows: 5_000, receipts: 50 };

export interface BackfillStats {
  sealed: Record<SealedTable | 'receipts', number>;
  /** Compare-and-set misses: a concurrent edit. Those rows are retried on a later run. */
  missed: number;
  /** Users whose key could not be produced this run; their rows are left for a later run. */
  failedOwners: number[];
  /**
   * Master-key rotation: keys moved onto the newest master key this run, keys that could not be,
   * and keys still not under it. staleKeys=0 is when the older DATA_KEK_<n> can be removed.
   */
  rewrapped: number;
  rewrapFailed: number;
  staleKeys: number;
  /** False when the budget ran out, or anything was missed or skipped. */
  complete: boolean;
}

export type BackfillEnv = KeyEnv & { RECEIPTS?: R2Bucket };

type Row = Record<string, unknown> & { id: number; owner: number };

const PAGE = 100;
const BATCH = 50;

/**
 * Compare-and-set statements sealing `rows` of `table`: `… WHERE id = ? AND text_enc = 0 AND
 * col IS ? …` against the values read, so a row edited since misses. Exported for tests.
 */
export async function sealStatements(
  ring: DataKeyring,
  table: SealedTable,
  rows: Row[],
  failed: Set<number>
): Promise<D1PreparedStatement[]> {
  const cols = SEALED_COLUMNS[table];
  const assignment = cols.map((c) => `${c} = ?`).join(', ');
  const unchanged = cols.map((c) => `${c} IS ?`).join(' AND ');
  const out: D1PreparedStatement[] = [];
  for (const row of rows) {
    if (failed.has(row.owner)) continue;
    let key: CryptoKey | null;
    try {
      key = await ring.forWrite(row.owner);
    } catch (e) {
      if (!(e instanceof DataKeyUnavailableError)) throw e;
      failed.add(row.owner);
      continue;
    }
    if (!key) continue; // no master key; the caller has already returned in that case
    const sealed: unknown[] = [];
    for (const column of cols) {
      sealed.push(await sealField(key, row[column], { table, column, userId: row.owner }));
    }
    out.push(
      ring.env.DB.prepare(
        `UPDATE ${table} SET ${assignment}, text_enc = 1 WHERE id = ? AND text_enc = 0 AND ${unchanged}`
      ).bind(...sealed, row.id, ...cols.map((c) => row[c]))
    );
  }
  return out;
}

export async function runFieldEncryptionBackfill(
  env: BackfillEnv,
  budget: BackfillBudget = DEFAULT_BUDGET
): Promise<BackfillStats | null> {
  const ring = new DataKeyring(env);
  if (!ring.enabled) return null;

  const started = Date.now();
  const outOfTime = () => Date.now() - started > budget.ms;
  const failed = new Set<number>();
  const stats: BackfillStats = {
    sealed: { transactions: 0, recurring_transactions: 0, bills: 0, receipts: 0 },
    missed: 0,
    failedOwners: [],
    rewrapped: 0,
    rewrapFailed: 0,
    staleKeys: 0,
    complete: true,
  };
  const finish = (): BackfillStats => {
    stats.failedOwners = [...failed];
    if (failed.size > 0 || stats.missed > 0) stats.complete = false;
    console.log(
      `[backfill] sealed tx=${stats.sealed.transactions} recurring=${stats.sealed.recurring_transactions} ` +
        `bills=${stats.sealed.bills} receipts=${stats.sealed.receipts} missed=${stats.missed} ` +
        `failedOwners=${stats.failedOwners.join(',') || 'none'} rewrapped=${stats.rewrapped} ` +
        `rewrapFailed=${stats.rewrapFailed} staleKeys=${stats.staleKeys} complete=${stats.complete}`
    );
    return stats;
  };

  // Rotation first. Between rotations it is one index lookup that finds nothing; during one it is
  // the step an operator waits on.
  const rewrap = await rewrapStaleKeys(env, { limit: budget.keys ?? 1_000, outOfTime });
  stats.rewrapped = rewrap.rewrapped;
  stats.rewrapFailed = rewrap.failed;
  stats.staleKeys = rewrap.remaining;
  if (rewrap.remaining > 0) stats.complete = false;

  let rowsLeft = budget.rows;
  for (const table of Object.keys(SEALED_COLUMNS) as SealedTable[]) {
    const cols = SEALED_COLUMNS[table];
    // Keyset pagination: a row that misses is not re-read in this run, so one row being edited
    // continuously cannot hold the run in a loop.
    let afterId = 0;
    for (;;) {
      if (rowsLeft <= 0 || outOfTime()) {
        stats.complete = false;
        return finish();
      }
      const rows = await db.all<Row>(
        env.DB,
        `SELECT t.id, p.user_id AS owner, ${cols.map((c) => `t.${c}`).join(', ')}
           FROM ${table} t
           JOIN profiles p ON p.id = t.profile_id
           JOIN users u ON u.id = p.user_id
          WHERE t.text_enc = 0 AND t.id > ?
          ORDER BY t.id
          LIMIT ?`,
        afterId,
        Math.min(PAGE, rowsLeft)
      );
      if (rows.length === 0) break;
      afterId = rows[rows.length - 1].id;
      const statements = await sealStatements(ring, table, rows, failed);
      // Only rows it could seal spend the budget. An owner whose key cannot be produced keeps their
      // rows at text_enc 0 and every run reads them again from id 0; counted, a few thousand of
      // them at low ids would use up every run's budget and nobody after them would ever be sealed.
      // Reading past them is bounded by the time budget instead.
      rowsLeft -= rows.filter((row) => !failed.has(row.owner)).length;
      for (let i = 0; i < statements.length; i += BATCH) {
        const chunk = statements.slice(i, i + BATCH);
        const changed = changesOf(await env.DB.batch(chunk));
        stats.sealed[table] += changed;
        stats.missed += chunk.length - changed;
      }
    }
  }

  if (env.RECEIPTS) {
    const bucket = env.RECEIPTS;
    let afterId = 0;
    let left = budget.receipts;
    for (;;) {
      if (left <= 0 || outOfTime()) {
        stats.complete = false;
        break;
      }
      const rows = await db.all<{ id: number; owner: number; storage_path: string }>(
        env.DB,
        `SELECT r.id, p.user_id AS owner, r.storage_path
           FROM receipts r
           JOIN profiles p ON p.id = r.profile_id
           JOIN users u ON u.id = p.user_id
          WHERE r.enc = 0 AND r.id > ?
          ORDER BY r.id
          LIMIT ?`,
        afterId,
        Math.min(10, left)
      );
      if (rows.length === 0) break;
      for (const r of rows) {
        afterId = r.id;
        if (failed.has(r.owner)) continue; // as for rows: skipping costs no budget
        left--;
        // A fresh key, so a failure midway leaves the original untouched. Only after the row
        // points at the sealed copy is the plaintext original deleted.
        const toKey = `${r.storage_path}.sealed-${crypto.randomUUID().slice(0, 8)}`;
        try {
          if (!(await resealReceipt(ring, r.owner, bucket, r.storage_path, toKey))) continue;
          const res = await db.run(
            env.DB,
            'UPDATE receipts SET storage_path = ?, enc = 1 WHERE id = ? AND enc = 0 AND storage_path = ?',
            toKey,
            r.id,
            r.storage_path
          );
          if ((res.meta.changes ?? 0) === 1) {
            stats.sealed.receipts++;
            await bucket.delete(r.storage_path).catch((e: unknown) => {
              console.error(
                `[backfill] sealed receipt ${r.id}, but deleting plaintext ${r.storage_path} failed`,
                e
              );
            });
          } else {
            stats.missed++;
            await bucket.delete(toKey).catch(() => {});
          }
        } catch (e) {
          if (e instanceof DataKeyUnavailableError) failed.add(r.owner);
          else console.error(`[backfill] receipt ${r.id} failed`, e);
          await bucket.delete(toKey).catch(() => {});
        }
      }
    }
  }
  return finish();
}
