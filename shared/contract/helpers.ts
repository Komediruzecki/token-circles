/**
 * Small helpers the scenarios share: dates, money, and reading a list either runtime answers.
 * Like the rest of shared/contract, nothing here imports vitest; `expect` is handed in.
 */
import { added, expectOk } from './types';
import type { ContractApi, Expect, Json, Reply } from './types';

/** `YYYY-MM-DD` for a date, in UTC as the Worker reads it. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The first day of the month `offset` months from this one, as `YYYY-MM-DD`. */
export function monthStart(offset = 0, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1));
  return isoDay(d);
}

/** The last day of the month `offset` months from this one, as `YYYY-MM-DD`. */
export function monthEnd(offset = 0, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset + 1, 0));
  return isoDay(d);
}

/** A day of the month `offset` months from this one, as `YYYY-MM-DD`. */
export function dayOf(offset: number, day: number, from = new Date()): string {
  return `${monthStart(offset, from).slice(0, 8)}${String(day).padStart(2, '0')}`;
}

/** Money compared to the cent, whether the runtime answered a number or a numeric string. */
export function expectMoney(expect: Expect, actual: unknown, cents: number, what = 'amount'): void {
  expect(Number(actual), `${what} was ${JSON.stringify(actual)}`).toBeCloseTo(cents, 2);
}

/**
 * The rows of `GET /api/transactions`.
 *
 * DIFFERENCE transactions-list-shape: the Worker answers `{ rows, total, limit, offset }`, local-first
 * a bare array. The app reads both through `listRows()` (core/api.ts).
 */
export function transactionRows(api: ContractApi, expect: Expect, reply: Reply): Json[] {
  expectOk(expect, reply, 'GET /api/transactions');
  if (api.runtime === 'worker') {
    expect(Array.isArray(reply.body?.rows), 'the Worker answers { rows }').toBe(true);
    return reply.body.rows as Json[];
  }
  expect(Array.isArray(reply.body), 'local-first answers an array').toBe(true);
  return reply.body as Json[];
}

/** `GET /api/transactions` with a query, as rows. */
export async function listTransactions(
  api: ContractApi,
  expect: Expect,
  query = ''
): Promise<Json[]> {
  return transactionRows(api, expect, await api.get(`/api/transactions${query}`));
}

/** A row's id list, for comparing sets and orders. */
export function idsOf(rows: readonly Json[]): number[] {
  return rows.map((row) => Number(row.id));
}

/** One account's stored balance, read back through `GET /api/accounts/:id`. */
export async function balanceOf(api: ContractApi, expect: Expect, id: number): Promise<number> {
  const reply = await api.get(`/api/accounts/${id}`);
  expectOk(expect, reply, `GET /api/accounts/${id}`);
  return Number(reply.body.balance);
}

/** A category, as the Categories form adds it. */
export async function addCategory(
  api: ContractApi,
  expect: Expect,
  name: string,
  type = 'expense'
): Promise<number> {
  return added(api, expect, '/api/categories', { name, type, color: '#aa5500', icon: 'tag' });
}

/** A transaction, as the Transactions form sends it (features/Transactions.tsx, the Save handler). */
export async function addTransaction(
  api: ContractApi,
  expect: Expect,
  fields: Record<string, unknown>
): Promise<number> {
  return added(api, expect, '/api/transactions', {
    description: 'Groceries',
    amount: 10,
    date: '2026-03-10',
    type: 'expense',
    category_id: null,
    currency: 'EUR',
    ...fields,
  });
}
