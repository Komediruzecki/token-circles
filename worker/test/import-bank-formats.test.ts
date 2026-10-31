/**
 * Migration 0038 gives an import log the bank formats its session read (shared/bankFormats.ts).
 *
 * The column is added with no default and no rewrite: a log written before it reads NULL, which is
 * "no bank format". What the import log route stores for it is the CRUD contract's
 * (shared/contract/scenarios/imports.ts), in both runtimes; the API import's writer is tested in
 * v1-import-bank.test.ts.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

interface Column {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
}

describe('migration 0038', () => {
  it('adds bank_formats as text, nullable and with no default', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(import_logs)').all<Column>();
    expect(results.find((c) => c.name === 'bank_formats')).toMatchObject({
      type: 'TEXT',
      notnull: 0,
      dflt_value: null,
    });
  });

  it('leaves a log written without it reading NULL', async () => {
    const id = 938001;
    const user = 93800;
    const profile = 938000;
    await env.DB.prepare('DELETE FROM import_logs WHERE id = ?').bind(id).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, 'formats@example.com', 'pbkdf2$100000$x$y', 'password', 1, 1)"
    )
      .bind(user)
      .run();
    await env.DB.prepare("INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'Old', ?)")
      .bind(profile, user)
      .run();
    await env.DB.prepare(
      "INSERT INTO import_logs (id, profile_id, source, imported) VALUES (?, ?, 'old.csv', 3)"
    )
      .bind(id, profile)
      .run();
    const row = await env.DB.prepare('SELECT bank_formats FROM import_logs WHERE id = ?')
      .bind(id)
      .first();
    expect(row).toEqual({ bank_formats: null });
    await env.DB.prepare('DELETE FROM import_logs WHERE id = ?').bind(id).run();
  });
});
