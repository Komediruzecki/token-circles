/**
 * The tools that move bytes. Neither the upload nor the download passes data through a tool
 * result: both hand back a short-lived signed URL for the agent to curl, so a 5MB statement
 * never becomes 7MB of base64 in a model's context.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mintApiToken } from '../src/apitoken';
import { verifyCapability } from '../src/signed-url';

const USER_ID = 9500;
const PROFILE_ID = 9501;
const SECRET = 'test-jwt-secret-not-for-prod';
let secret = '';

async function call(
  name: string,
  args: Record<string, unknown> = {},
  token = secret
): Promise<any> {
  const res = await SELF.fetch('https://api.example.com/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  return ((await res.json()) as any).result;
}

const unwrap = (result: any): any => {
  if (result?.isError) throw new Error(result.content[0].text);
  return result.structuredContent;
};

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, 'imp@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
  )
    .bind(USER_ID)
    .run();
  await env.DB.prepare("INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'Imp', ?)")
    .bind(PROFILE_ID, USER_ID)
    .run();
  secret = (
    await mintApiToken(env.DB, USER_ID, {
      name: 'imp',
      scopes: ['read', 'import'],
      defaultProfileId: PROFILE_ID,
    })
  ).secret;
});

describe('import tools', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM import_logs WHERE profile_id = ?').bind(PROFILE_ID).run();
    await env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE_ID).run();
  });

  it('prepare_import returns a usable, purpose-bound, expiring capability', async () => {
    const out = unwrap(await call('prepare_import', { mode: 'commit' }));
    expect(out.uploadUrl).toContain('/api/v1/import');
    expect(out.method).toBe('POST');
    expect(out.fileField).toBe('file');
    expect(out.curl).toContain('curl');
    expect(out.curl).toContain(out.uploadUrl);
    expect(out.expiresInSeconds).toBe(900);

    const sig = new URL(out.uploadUrl).searchParams.get('sig') ?? '';
    const cap = await verifyCapability(sig, 'import', SECRET);
    expect(cap).toMatchObject({ userId: USER_ID, profileId: PROFILE_ID, purpose: 'import' });
    expect(await verifyCapability(sig, 'snapshot', SECRET)).toBeNull();
  });

  it('prepare_import mints a fresh importId per call, and honours an explicit one', async () => {
    const a = unwrap(await call('prepare_import', { mode: 'commit' }));
    const b = unwrap(await call('prepare_import', { mode: 'commit' }));
    expect(a.importId).not.toBe(b.importId);
    expect(a.guidance).toMatch(/fresh/i);

    const pinned = unwrap(await call('prepare_import', { mode: 'commit', importId: 'batch-jan' }));
    expect(pinned.importId).toBe('batch-jan');
    expect(new URL(pinned.uploadUrl).searchParams.get('importId')).toBe('batch-jan');
  });

  it('export_snapshot returns a snapshot-purpose download URL', async () => {
    const out = unwrap(await call('export_snapshot', {}));
    expect(out.downloadUrl).toContain('/api/v1/snapshot');
    const sig = new URL(out.downloadUrl).searchParams.get('sig') ?? '';
    expect(await verifyCapability(sig, 'snapshot', SECRET)).not.toBeNull();
    expect(await verifyCapability(sig, 'import', SECRET)).toBeNull();
  });

  it('list_imports reports what has landed, newest first', async () => {
    for (const [importId, imported, when] of [
      ['imp-a', 4, '2026-01-01 10:00:00'],
      ['imp-b', 7, '2026-02-01 10:00:00'],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO import_logs (profile_id, import_id, source, imported, created_at) VALUES (?, ?, 'API import (x.csv)', ?, ?)"
      )
        .bind(PROFILE_ID, importId, imported, when)
        .run();
    }
    const out = unwrap(await call('list_imports', {}));
    expect(out.imports[0].importId).toBe('imp-b');
    expect(out.imports[0].imported).toBe(7);
    expect(out.imports).toHaveLength(2);
  });

  it('undo_import removes exactly that batch and nothing else', async () => {
    for (const [importId, description] of [
      ['imp-a', 'from A'],
      ['imp-b', 'from B'],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO transactions (date, description, amount, type, currency, profile_id, import_id) VALUES ('2026-01-05', ?, -10, 'expense', 'EUR', ?, ?)"
      )
        .bind(description, PROFILE_ID, importId)
        .run();
      await env.DB.prepare(
        "INSERT INTO import_logs (profile_id, import_id, source, imported) VALUES (?, ?, 'x', 1)"
      )
        .bind(PROFILE_ID, importId)
        .run();
    }

    const out = unwrap(await call('undo_import', { importId: 'imp-a' }));
    expect(out.deleted).toBe(1);
    const left = await env.DB.prepare('SELECT description FROM transactions WHERE profile_id = ?')
      .bind(PROFILE_ID)
      .all<{ description: string }>();
    expect(left.results?.map((r) => r.description)).toEqual(['from B']);
  });

  it("undo_import will not touch another profile's batch", async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (9599, 'them@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
    ).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (9599, 'Theirs', 9599)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO transactions (date, description, amount, type, currency, profile_id, import_id) VALUES ('2026-01-05', 'theirs', -10, 'expense', 'EUR', 9599, 'imp-theirs')"
    ).run();
    const out = unwrap(await call('undo_import', { importId: 'imp-theirs' }));
    expect(out.deleted).toBe(0);
    const still = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE import_id = 'imp-theirs'"
    ).first<{ n: number }>();
    expect(still?.n).toBe(1);
  });

  it('403s an import tool for a token without the import scope', async () => {
    const readOnly = (
      await mintApiToken(env.DB, USER_ID, {
        name: 'ro',
        scopes: ['read'],
        defaultProfileId: PROFILE_ID,
      })
    ).secret;
    const result = await call('prepare_import', { mode: 'commit' }, readOnly);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('import');
  });
});
