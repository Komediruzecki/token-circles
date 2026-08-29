/**
 * The ingest endpoint. Bytes arrive over plain HTTP under a short-lived signed capability, so
 * they never travel through an MCP tool argument (and therefore never through a model's context).
 *
 * The freshness property is the one an unattended routine depends on: re-running the same month
 * with a FRESH importId must import nothing and report the rows as duplicates, leaving every
 * previously-imported row -- and any categorization since applied -- untouched.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { signCapability } from '../src/signed-url';
// Imported as text, not read from disk: these tests run inside workerd, which has no host
// filesystem. Vite inlines the ?raw import at build time.
import cleanCsv from './fixtures/statement-clean.csv?raw';
import messyCsv from './fixtures/statement-messy.csv?raw';

const FIXTURES: Record<string, string> = {
  'statement-clean.csv': cleanCsv,
  'statement-messy.csv': messyCsv,
};

const USER_ID = 9200;
const PROFILE_ID = 9201;
const SECRET = 'test-jwt-secret-not-for-prod';

async function seed(): Promise<void> {
  await env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE_ID).run();
  await env.DB.prepare('DELETE FROM import_logs WHERE profile_id = ?').bind(PROFILE_ID).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, 'v1@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
  )
    .bind(USER_ID)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'V1 Profile', ?)"
  )
    .bind(PROFILE_ID, USER_ID)
    .run();
}

async function post(opts: {
  file: string;
  mode: 'preview' | 'commit';
  importId?: string;
  sig?: string;
}): Promise<Response> {
  const sig =
    opts.sig ??
    (await signCapability(
      { tokenId: 'tok-v1', userId: USER_ID, profileId: PROFILE_ID, purpose: 'import' },
      SECRET
    ));
  const form = new FormData();
  form.append('file', new File([FIXTURES[opts.file]!], opts.file, { type: 'text/csv' }));
  const qs = new URLSearchParams({ sig, mode: opts.mode });
  if (opts.importId) qs.set('importId', opts.importId);
  return SELF.fetch(`https://api.example.com/api/v1/import?${qs}`, { method: 'POST', body: form });
}

const txCount = async (): Promise<number> =>
  (
    await env.DB.prepare('SELECT COUNT(*) AS n FROM transactions WHERE profile_id = ?')
      .bind(PROFILE_ID)
      .first<{ n: number }>()
  )?.n ?? 0;

describe('POST /api/v1/import', () => {
  beforeEach(seed);

  it('rejects a missing, wrong-purpose or expired capability', async () => {
    const noSig = await SELF.fetch('https://api.example.com/api/v1/import', { method: 'POST' });
    expect(noSig.status).toBe(401);

    const wrongPurpose = await signCapability(
      { tokenId: 't', userId: USER_ID, profileId: PROFILE_ID, purpose: 'snapshot' },
      SECRET
    );
    expect(
      (await post({ file: 'statement-clean.csv', mode: 'commit', sig: wrongPurpose })).status
    ).toBe(401);

    const expired = await signCapability(
      { tokenId: 't', userId: USER_ID, profileId: PROFILE_ID, purpose: 'import' },
      SECRET,
      -10
    );
    expect((await post({ file: 'statement-clean.csv', mode: 'commit', sig: expired })).status).toBe(
      401
    );
  });

  it('previews without mutating anything', async () => {
    const res = await post({ file: 'statement-clean.csv', mode: 'preview' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.mode).toBe('preview');
    expect(body.dateParseRate).toBe(1);
    expect(body.amountParseRate).toBe(1);
    expect(body.mapping).toMatchObject({ date: 0, description: 1, amount: 2 });
    expect(await txCount()).toBe(0);
  });

  it('commits four rows and writes an import_logs entry', async () => {
    const res = await post({ file: 'statement-clean.csv', mode: 'commit' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number; importId: string };
    expect(body.imported).toBe(4);
    expect(await txCount()).toBe(4);

    const log = await env.DB.prepare('SELECT source, imported FROM import_logs WHERE import_id = ?')
      .bind(body.importId)
      .first<{ source: string; imported: number }>();
    expect(log?.imported).toBe(4);
    expect(log?.source).toContain('statement-clean.csv');
  });

  it('FRESHNESS: a re-run with a fresh importId imports nothing and reports duplicates', async () => {
    const first = (await (await post({ file: 'statement-clean.csv', mode: 'commit' })).json()) as {
      importId: string;
    };
    const again = (await (await post({ file: 'statement-clean.csv', mode: 'commit' })).json()) as {
      imported: number;
      duplicates: number;
      importId: string;
    };
    expect(again.importId).not.toBe(first.importId);
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(4);
    expect(await txCount()).toBe(4);
  });

  it('a re-run with a STABLE importId replaces that batch instead', async () => {
    await post({ file: 'statement-clean.csv', mode: 'commit', importId: 'batch-jan' });
    expect(await txCount()).toBe(4);
    const again = (await (
      await post({ file: 'statement-clean.csv', mode: 'commit', importId: 'batch-jan' })
    ).json()) as { imported: number };
    expect(again.imported).toBe(4);
    expect(await txCount()).toBe(4);
  });

  it('GATE: refuses a file whose date column is not dates, and mutates nothing', async () => {
    const res = await post({ file: 'statement-messy.csv', mode: 'commit' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; sample: unknown[] };
    expect(body.error).toContain('date');
    expect(body.sample.length).toBeGreaterThan(0);
    expect(await txCount()).toBe(0);
  });

  it('refuses an oversized body and a non-tabular file', async () => {
    const sig = await signCapability(
      { tokenId: 't', userId: USER_ID, profileId: PROFILE_ID, purpose: 'import' },
      SECRET
    );
    const big = new FormData();
    big.append(
      'file',
      new File([new Uint8Array(11 * 1024 * 1024)], 'huge.csv', { type: 'text/csv' })
    );
    const tooBig = await SELF.fetch(
      `https://api.example.com/api/v1/import?sig=${sig}&mode=commit`,
      { method: 'POST', body: big }
    );
    expect(tooBig.status).toBe(413);

    const junk = new FormData();
    junk.append('file', new File(['not a table'], 'notes.txt', { type: 'text/plain' }));
    const unparseable = await SELF.fetch(
      `https://api.example.com/api/v1/import?sig=${sig}&mode=commit`,
      { method: 'POST', body: junk }
    );
    expect(unparseable.status).toBe(422);
  });

  it('does not import into a profile the capability does not name', async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (9299, 'x@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
    ).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (9299, 'Other', 9299)"
    ).run();
    const forged = await signCapability(
      { tokenId: 't', userId: USER_ID, profileId: 9299, purpose: 'import' },
      SECRET
    );
    const res = await post({ file: 'statement-clean.csv', mode: 'commit', sig: forged });
    expect(res.status).toBe(403);
    expect(await txCount()).toBe(0);
  });
});

describe('GET /api/v1/snapshot', () => {
  beforeEach(seed);

  const snapshotSig = (purpose: 'snapshot' | 'import' = 'snapshot') =>
    signCapability({ tokenId: 't', userId: USER_ID, profileId: PROFILE_ID, purpose }, SECRET);

  it("returns the profile's data for a snapshot capability only", async () => {
    await post({ file: 'statement-clean.csv', mode: 'commit' });

    const wrong = await SELF.fetch(
      `https://api.example.com/api/v1/snapshot?sig=${await snapshotSig('import')}`
    );
    expect(wrong.status).toBe(401);

    const res = await SELF.fetch(
      `https://api.example.com/api/v1/snapshot?sig=${await snapshotSig()}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transactions?: unknown[] };
    expect(Array.isArray(body.transactions)).toBe(true);
    expect(body.transactions).toHaveLength(4);
  });

  it('omits base64 receipt bytes unless they are explicitly asked for', async () => {
    // exportBackup embeds every receipt file as base64. That is right for a backup and wrong
    // for an agent pulling the ledger to analyse it -- the scans dwarf the data and are useless
    // for the task. Default to the numbers; make the bytes opt-in.
    const lean = await SELF.fetch(
      `https://api.example.com/api/v1/snapshot?sig=${await snapshotSig()}`
    );
    const leanBody = (await lean.json()) as Record<string, unknown>;
    expect(leanBody.receiptFiles).toEqual([]);
    expect(leanBody.receiptFilesOmitted).toBe(true);

    const full = await SELF.fetch(
      `https://api.example.com/api/v1/snapshot?sig=${await snapshotSig()}&includeReceiptFiles=true`
    );
    const fullBody = (await full.json()) as Record<string, unknown>;
    expect(fullBody.receiptFilesOmitted).toBe(false);
  });

  it('refuses a profile the capability does not name', async () => {
    const forged = await signCapability(
      { tokenId: 't', userId: USER_ID, profileId: 9299, purpose: 'snapshot' },
      SECRET
    );
    const res = await SELF.fetch(`https://api.example.com/api/v1/snapshot?sig=${forged}`);
    expect(res.status).toBe(403);
  });
});
