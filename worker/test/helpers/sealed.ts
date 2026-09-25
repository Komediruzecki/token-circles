import { env } from 'cloudflare:test';
import { DataKeyring } from '../../src/data-keys';
import { openRows, type SealedTable } from '../../src/sealed-rows';

/**
 * Read rows straight from D1 and open their sealed columns, so a test that asserts on stored text
 * means the same thing whether the suite runs with TEST_DATA_KEK or without. The SELECT must
 * include `text_enc`; `owner` is the user whose key seals these rows.
 */
export async function openedRows<T = Record<string, unknown>>(
  table: SealedTable,
  owner: number,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const { results } = await env.DB.prepare(sql)
    .bind(...params)
    .all<Record<string, unknown>>();
  return (await openRows(new DataKeyring(env), owner, table, results)) as T[];
}

export async function openedRow<T = Record<string, unknown>>(
  table: SealedTable,
  owner: number,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (await openedRows<T>(table, owner, sql, ...params))[0] ?? null;
}
