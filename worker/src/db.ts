// Thin async data-access helpers over D1 — the Worker analog of
// backend/repositories/baseRepo.js. D1 is SQLite, so the SQL is identical; only
// the API is async (prepare().bind().all()/first()/run()).
//
// Identifier validation mirrors the backend's _validateTable/_validateColumns so
// the same SQL-injection guard applies to any interpolated table/column names.

const IDENT = /^[a-zA-Z0-9_]+$/

function assertIdent(name: string): void {
  if (!IDENT.test(name)) throw new Error(`Invalid identifier: ${name}`)
}

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<T>()
  return results ?? []
}

export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (await db
    .prepare(sql)
    .bind(...params)
    .first<T>()) ?? null
}

export async function run(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run()
}

/** INSERT helper — validates table + column identifiers, parameterizes values. */
export async function insert(
  db: D1Database,
  table: string,
  data: Record<string, unknown>
): Promise<D1Result> {
  assertIdent(table)
  const keys = Object.keys(data)
  keys.forEach(assertIdent)
  const placeholders = keys.map(() => '?').join(', ')
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
  return run(db, sql, ...Object.values(data))
}
