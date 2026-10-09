/**
 * A D1 that runs one more step right after a chosen statement, before the route that ran it
 * carries on. A test uses it to change an account at an exact point inside a request: between a
 * route's check of a credential and the write that follows it.
 *
 * The suite's `env` is the object the Worker's own requests see, so swapping its DB for the
 * request (withDb) is enough for SELF.fetch to run on this one.
 */
import { env } from 'cloudflare:test';
import { clearUnconfirmedAccess } from '../../src/auth';

/** The database the suite was given, for steps that must not run through the wrapper. */
export const realDb: D1Database = env.DB;

const unwrapped = new WeakMap<object, D1PreparedStatement>();
const sqlOf = new WeakMap<object, string>();

export interface DbWithStep {
  db: D1Database;
  /** Whether the step has run. A test checks it, so a statement that no longer matches fails. */
  ran: () => boolean;
}

/**
 * `db`, which runs `step` once, right after the first statement whose SQL matches `after` has run
 * (alone or in a batch), and before its result reaches the code that ran it.
 */
export function dbWithStep(
  db: D1Database,
  after: RegExp,
  step: () => Promise<unknown>
): DbWithStep {
  let ran = false;
  const fire = async (sql: string): Promise<void> => {
    if (ran || !after.test(sql)) return;
    ran = true;
    await step();
  };
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, prop) {
        if (prop === 'bind') {
          return (...values: unknown[]) => wrap(target.bind(...values), sql);
        }
        if (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw') {
          return async (...args: unknown[]) => {
            const method = target[prop] as (...a: unknown[]) => Promise<unknown>;
            const result = await method.apply(target, args);
            await fire(sql);
            return result;
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? (value as Function).bind(target) : value;
      },
    });
    unwrapped.set(proxy, statement);
    sqlOf.set(proxy, sql);
    return proxy;
  };
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements.map((s) => unwrapped.get(s) ?? s));
          for (const s of statements) await fire(sqlOf.get(s) ?? '');
          return results;
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as Function).bind(target) : value;
    },
  });
  return { db: wrapped, ran: () => ran };
}

/** Run `request` with `db` as the Worker's database, then put the real one back. */
export async function withDb<T>(db: D1Database, request: () => Promise<T>): Promise<T> {
  const vars = env as unknown as { DB: D1Database };
  vars.DB = db;
  try {
    return await request();
  } finally {
    vars.DB = realDb;
  }
}

/**
 * What Google sign-in, an emailed code and a reset do to an account whose address was never
 * confirmed: clear every way in, then confirm the address.
 */
export const clearAndConfirm = (userId: number) =>
  realDb.batch([
    ...clearUnconfirmedAccess(realDb, userId),
    realDb.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId),
  ]);

/** Move the account's token_version on, as signing out everywhere does. */
export const bumpTokenVersion = (userId: number) =>
  realDb
    .prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?')
    .bind(userId)
    .run();
