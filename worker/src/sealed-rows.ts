/**
 * Which columns are sealed, and the three helpers every read and write path goes through.
 *
 *   sealForInsert  seal a new row's text under its owner's key; text_enc says which form it is in.
 *   sealedUpdate   change sealed columns WITHOUT reading the row first (see below for why).
 *   openRows       open rows read back; rows at text_enc 0 pass through untouched.
 *
 * The owner is profiles.user_id of the row's profile — the user whose key seals it. Profiles are
 * never shared between users (every access check is `id = ? AND user_id = ?`), so one key per
 * user covers a user's whole multi-profile household.
 *
 * What SQL can no longer do with a sealed column: filter on it (=, LIKE, IN), sort by it, group by
 * it, COALESCE or concatenate it, or copy it into another table. A fresh IV per value makes equal
 * text unequal ciphertext, and additional data binds each value to its own table and column. All
 * of that moves into JS after openRows — textMatches is the stand-in for LIKE.
 */
import type { DataKeyring } from './data-keys';
import { openField, sealField, TEXT_PREFIX } from './field-crypto';

export const SEALED_COLUMNS = {
  transactions: ['description', 'beneficiary', 'payor', 'notes'],
  recurring_transactions: ['description', 'notes'],
  bills: ['name', 'notes'],
  // Migration 0033: the free text beside the ledger.
  accounts: ['notes'],
  savings_goals: ['notes'],
  retirement_goals: ['notes'],
  loan_prepayments: ['note'],
  housings: ['notes'],
  portfolio_holdings: ['notes'],
  category_mappings: ['pattern'],
  tag_rules: ['criteria'],
} as const;

export type SealedTable = keyof typeof SEALED_COLUMNS;
type Row = Record<string, unknown>;

/**
 * Sealed columns whose DEFAULT is not empty. An INSERT through sealForInsert must name them: left
 * out, the default would sit unsealed in a row marked sealed, where it fails to open. Every other
 * sealed column defaults to '' or NULL, which are stored unsealed in either form. A test holds this
 * list to the schema.
 */
export const MUST_NAME_ON_INSERT = {
  tag_rules: ['criteria'], // DEFAULT '{}'
} as const satisfies Partial<Record<SealedTable, readonly string[]>>;

const MARKER = 'text_enc';
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sealedColumns(table: SealedTable): readonly string[] {
  return SEALED_COLUMNS[table];
}

/**
 * What each sealed column in `values` would hold if it were written as is. D1 binds a JS number
 * (or boolean) as REAL, and the TEXT column renders it SQLite's way: 1234 is stored as '1234.0',
 * true as '1.0'. Sealing String(v) instead would keep '1234' — the same input stored differently
 * depending on whether a key exists. Asking SQLite gives its exact rendering. Strings, '' and NULL
 * need no round trip, and the app only ever sends those; a raw API body or a spreadsheet cell can
 * carry the rest.
 */
async function asColumnText(db: D1Database, values: Row, columns: readonly string[]): Promise<Row> {
  const odd = columns.filter((c) => {
    const v = values[c];
    return v !== null && v !== undefined && typeof v !== 'string';
  });
  if (odd.length === 0) return { ...values }; // a copy: callers seal into it
  const row = await db
    .prepare(`SELECT ${odd.map((_, i) => `CAST(?${i + 1} AS TEXT) AS c${i}`).join(', ')}`)
    .bind(...odd.map((c) => values[c]))
    .first<Row>();
  const out: Row = { ...values };
  odd.forEach((c, i) => {
    out[c] = row?.[`c${i}`] ?? null;
  });
  return out;
}

/**
 * For an INSERT: seals whichever sealed columns `values` carries and adds the text_enc the row
 * must be stored with. Sealed columns the INSERT leaves out get the column DEFAULT, '' or NULL,
 * which field-crypto stores unsealed in either form — so a sealed row never holds a plaintext
 * value that is not empty. The few with any other default (MUST_NAME_ON_INSERT) must be given.
 *
 * ownerId null is a legacy profile nobody owns: nobody holds a key, so the row stays plaintext.
 */
export async function sealForInsert<T extends Row>(
  ring: DataKeyring,
  ownerId: number | null,
  table: SealedTable,
  values: T
): Promise<T & { text_enc: 0 | 1 }> {
  const mustName: Partial<Record<SealedTable, readonly string[]>> = MUST_NAME_ON_INSERT;
  for (const column of mustName[table] ?? []) {
    if (values[column] === undefined) {
      throw new Error(`sealForInsert: ${table}.${column} must be given; its default is not empty`);
    }
  }
  const key = ownerId === null ? null : await ring.forWrite(ownerId);
  if (!key || ownerId === null) return { ...values, text_enc: 0 };
  const out: Row = await asColumnText(
    ring.env.DB,
    values,
    sealedColumns(table).filter((c) => c in values)
  );
  for (const column of sealedColumns(table)) {
    if (column in out)
      out[column] = await sealField(key, out[column], { table, column, userId: ownerId });
  }
  out[MARKER] = 1;
  return out as T & { text_enc: 0 | 1 };
}

/**
 * An UPDATE that sets sealed columns, as statements for ONE db.batch — which D1 runs as a single
 * transaction.
 *
 * Why two statements and no read: the backfill flips a row from plaintext to sealed at any
 * moment. An edit that read text_enc = 0 and then wrote plaintext could land just after that flip,
 * leaving plaintext in a row marked sealed — unreadable for good. So instead the edit is offered
 * in both forms, `… AND text_enc = 1` with the sealed value and `… AND text_enc = 0` with the
 * plain one, and the database applies whichever matches the row as it stands when the batch runs.
 * Exactly one can. Sum the two results' changes (changesOf) for the number of rows updated.
 *
 * `set` may mix sealed and ordinary columns; only the sealed ones differ between the two forms.
 * With no sealed column in `set`, it is one plain statement and text_enc is not consulted.
 */
export async function sealedUpdate(
  ring: DataKeyring,
  ownerId: number | null,
  table: SealedTable,
  set: Row,
  whereSql: string,
  whereParams: unknown[]
): Promise<D1PreparedStatement[]> {
  const cols = Object.keys(set).filter((c) => set[c] !== undefined);
  if (cols.length === 0) throw new Error('sealedUpdate: nothing to set');
  for (const c of cols) if (!IDENT.test(c)) throw new Error(`sealedUpdate: bad column name ${c}`);
  const sealedCols = sealedColumns(table);
  const assignment = cols.map((c) => `${c} = ?`).join(', ');
  const statement = (values: Row, marker: 0 | 1 | null): D1PreparedStatement =>
    ring.env.DB.prepare(
      `UPDATE ${table} SET ${assignment} WHERE (${whereSql})${marker === null ? '' : ` AND ${MARKER} = ${marker}`}`
    ).bind(...cols.map((c) => values[c]), ...whereParams);

  if (!cols.some((c) => sealedCols.includes(c))) return [statement(set, null)];

  const key = ownerId === null ? null : await ring.forWrite(ownerId);
  // No key means none of this owner's rows can be sealed, so only the plain form can match. It
  // still carries `text_enc = 0`: were that ever wrong, the edit misses rather than corrupts.
  if (!key || ownerId === null) return [statement(set, 0)];
  const sealed: Row = await asColumnText(
    ring.env.DB,
    set,
    cols.filter((c) => sealedCols.includes(c))
  );
  for (const c of cols) {
    if (sealedCols.includes(c))
      sealed[c] = await sealField(key, sealed[c], { table, column: c, userId: ownerId });
  }
  return [statement(sealed, 1), statement(set, 0)];
}

/** Rows changed across a batch — for the statements sealedUpdate returns. */
export function changesOf(results: D1Result[]): number {
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

export interface OpenOptions {
  /** A sealed column selected under another name, e.g. { description: 'tx_description' }. */
  aliases?: Partial<Record<string, string>>;
  /** Keep text_enc on the returned rows. Off by default, so API responses are unchanged. */
  keepMarker?: boolean;
}

/**
 * Open the sealed columns of rows read from `table`. `owner` is the user id for a request (all of
 * its rows are that user's), or a function of the row where rows span users (cron jobs).
 *
 * A row selected without its text_enc is a bug in that SELECT. It is still handled correctly —
 * a value that starts with the sealed prefix AND authenticates under the owner's key is opened;
 * anything else is plaintext, because a plaintext that merely looks sealed cannot pass GCM
 * authentication — but it is logged with a stack, so the SELECT can be found and fixed.
 */
export async function openRows<R extends Row>(
  ring: DataKeyring,
  owner: number | ((row: R) => number | null),
  table: SealedTable,
  rows: R[],
  options: OpenOptions = {}
): Promise<R[]> {
  const cols = sealedColumns(table).map((c) => [c, options.aliases?.[c] ?? c] as const);
  const ownerOf = (row: R): number | null => (typeof owner === 'function' ? owner(row) : owner);
  const out: R[] = [];
  let warned = false;
  for (const row of rows) {
    const marker = row[MARKER];
    const opened: Row = { ...row };
    if (marker === 1) {
      const userId = ownerOf(row);
      if (userId === null) throw new Error(`${table}: sealed row with no owner`);
      const key = await ring.forRead(userId);
      for (const [column, field] of cols) {
        if (field in opened)
          opened[field] = await openField(key, opened[field], { table, column, userId });
      }
    } else if (marker !== 0) {
      const looksSealed = cols.some(
        ([, field]) =>
          typeof opened[field] === 'string' && (opened[field] as string).startsWith(TEXT_PREFIX)
      );
      if (!warned) {
        console.warn(`[sealed-rows] ${table} read without ${MARKER}; select it`, new Error().stack);
        warned = true;
      }
      const userId = ownerOf(row);
      if (looksSealed && userId !== null) {
        // No key on file: nothing of theirs was ever sealed, so these are plaintext. A key that
        // exists but cannot be produced throws, exactly as it would with the marker selected.
        const key = await ring.existing(userId);
        for (const [column, field] of cols) {
          const v = opened[field];
          if (key && typeof v === 'string' && v.startsWith(TEXT_PREFIX)) {
            opened[field] = await openField(key, v, { table, column, userId }).catch(() => v);
          }
        }
      }
    }
    if (!options.keepMarker) delete opened[MARKER];
    out.push(opened as R);
  }
  return out;
}

/**
 * The JS stand-in for `(a LIKE '%q%' OR b LIKE '%q%' …)` over opened text. Case-insensitive
 * across all of Unicode, where SQLite's LIKE folds ASCII only, and `%` or `_` in the query are
 * literal characters rather than wildcards — both strictly closer to what a user typing into a
 * search box means.
 */
export function textMatches(row: Row, fields: readonly string[], query: string): boolean {
  // toLowerCase, not toLocaleLowerCase: the fold must not depend on the runtime's locale.
  const needle = query.toLowerCase();
  if (needle === '') return true;
  return fields.some((f) => {
    const v = row[f];
    return typeof v === 'string' && v.toLowerCase().includes(needle);
  });
}

/**
 * SQLite's BINARY collation, for ORDER BY / GROUP BY moved into JS over opened rows: NULL first,
 * then numbers, then text by code unit — never localeCompare, which reorders case and accents.
 * Code-unit order equals SQLite's UTF-8 byte order except between astral characters and
 * U+E000..U+FFFF, which no ledger text is expected to mix.
 */
export function compareBinary(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  const na = typeof a === 'number';
  const nb = typeof b === 'number';
  if (na && nb) return a < b ? -1 : a > b ? 1 : 0;
  if (na !== nb) return na ? -1 : 1;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * SUM() and AVG() as SQLite computes them over REAL values: NULLs skipped, NULL over no values,
 * and Kahan-Babuska-Neumaier compensation (SQLite >= 3.43, the same branch it takes), so a total
 * moved into JS matches the SQL one to the last bit instead of drifting with row order.
 */
export class SqlSum {
  private s = 0;
  private err = 0;
  private n = 0;
  add(value: unknown): void {
    if (value === null || value === undefined) return;
    const v = Number(value);
    const t = this.s + v;
    this.err += Math.abs(this.s) > Math.abs(v) ? this.s - t + v : v - t + this.s;
    this.s = t;
    this.n++;
  }
  get count(): number {
    return this.n;
  }
  get sum(): number | null {
    return this.n ? this.s + this.err : null;
  }
  get avg(): number | null {
    return this.n ? (this.s + this.err) / this.n : null;
  }
}

/** SqlSum over an iterable, for the common one-shot case. */
export function sqlSum(values: Iterable<unknown>): number | null {
  const acc = new SqlSum();
  for (const v of values) acc.add(v);
  return acc.sum;
}
