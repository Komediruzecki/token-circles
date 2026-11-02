/**
 * Migration 0037 gives an account a limit and a yearly interest rate: a credit card's, or a Giro
 * account's overdraft's (shared/accountSchema.ts).
 *
 * The columns are added with no default and no rewrite: an account stored before them reads NULL
 * for both, which is "none given". What the routes store and answer for them is the CRUD
 * contract's (shared/contract/scenarios/accounts.ts), in both runtimes.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

interface Column {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
}

describe('migration 0037', () => {
  it('adds credit_limit and credit_rate as numbers, both nullable and with no default', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(accounts)').all<Column>();
    const column = (name: string) => results.find((c) => c.name === name);
    expect(column('credit_limit')).toMatchObject({ type: 'REAL', notnull: 0, dflt_value: null });
    expect(column('credit_rate')).toMatchObject({ type: 'REAL', notnull: 0, dflt_value: null });
  });

  it('leaves an account written without them reading NULL for both', async () => {
    const id = 937001;
    await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
    await env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type) VALUES (?, 1, 'Old card', 'credit')"
    )
      .bind(id)
      .run();
    const row = await env.DB.prepare('SELECT credit_limit, credit_rate FROM accounts WHERE id = ?')
      .bind(id)
      .first();
    expect(row).toEqual({ credit_limit: null, credit_rate: null });
    await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
  });
});
