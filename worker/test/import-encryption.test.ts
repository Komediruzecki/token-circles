/**
 * Field encryption on the import path: executeImport (src/routes/imports.ts) and the two callers
 * with nobody watching, the daily sheet sync and email-in. A master key is FORCED here whatever
 * mode the suite runs in, so this file proves the keyed behaviour in the keyless run too.
 *
 * The property that matters most is dedup. Its key is built from the stored description, so a
 * description read back as ciphertext never matches: every re-import, every re-forwarded statement
 * and every morning's sheet sync would silently duplicate everything. The tests below hold a keyed
 * run to exactly what the same scenario gives with no key, over a MIX of sealed rows and rows
 * still plaintext (text_enc 0, as the backfill leaves them until it reaches them).
 *
 * Users 51001-51006 only ever go through the forced-key env (or, for the parity user, only through
 * the keyless one), so no user holds a key the suite env cannot open.
 */
import { createExecutionContext, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app, { type Env } from '../src/index';
import { issueSessionCookie } from '../src/auth';
import { DataKeyring } from '../src/data-keys';
import { TEXT_PREFIX } from '../src/field-crypto';
import { handleIngestEmail } from '../src/import-email';
import { runScheduledSheetSyncs } from '../src/import-sync';
import { openRows } from '../src/sealed-rows';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { ...env, DATA_KEK_1: K } as unknown as Env;
// The same bindings with encryption off, whatever the suite mode: an empty secret is no secret.
const KEYLESS = { ...env, DATA_KEK_1: '' } as unknown as Env;

const USER = 51001;
const PROFILE = 51010;
const PARITY_USER = 51002;
const PARITY_PROFILE = 51020;
const SYNC_USER = 51003;
const SYNC_PROFILE = 51030;
const LEGACY_PROFILE = 51040; // user_id NULL: nobody owns it, so nobody holds a key for it
const EMAIL_USER = 51005;
const EMAIL_PROFILE = 51050;
const BROKEN_USER = 51006;
const BROKEN_PROFILE = 51060;

const USERS = [USER, PARITY_USER, SYNC_USER, EMAIL_USER, BROKEN_USER];
const PROFILES: Array<[number, number | null]> = [
  [PROFILE, USER],
  [PARITY_PROFILE, PARITY_USER],
  [SYNC_PROFILE, SYNC_USER],
  [LEGACY_PROFILE, null],
  [EMAIL_PROFILE, EMAIL_USER],
  [BROKEN_PROFILE, BROKEN_USER],
];
const DAILY_CRON = '0 8 * * *';
const in_ = (xs: unknown[]) => xs.map(() => '?').join(', ');

// sheet id -> CSV served to the stubbed fetch; anything else answers 404.
const sheets = new Map<string, string>();

beforeEach(async () => {
  const pids = PROFILES.map(([p]) => p);
  for (const t of ['transactions', 'import_logs', 'import_sources', 'accounts', 'categories']) {
    await env.DB.prepare(`DELETE FROM ${t} WHERE profile_id IN (${in_(pids)})`)
      .bind(...pids)
      .run();
  }
  await env.DB.prepare(`DELETE FROM profiles WHERE id IN (${in_(pids)})`)
    .bind(...pids)
    .run();
  await env.DB.prepare(`DELETE FROM users WHERE id IN (${in_(USERS)})`)
    .bind(...USERS)
    .run();
  await env.DB.batch([
    ...USERS.map((u) =>
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, ?, 'password', 1)"
      ).bind(u, `enc-import-${u}@example.com`)
    ),
    ...PROFILES.map(([p, u]) =>
      env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
        p,
        u,
        `Encrypted imports ${p}`
      )
    ),
  ]);

  sheets.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const id = url.match(/\/spreadsheets\/d\/([^/]+)\//)?.[1] ?? '';
      const body = sheets.get(id);
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv' } });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Raw = {
  id: number;
  date: string;
  description: string;
  beneficiary: string;
  payor: string;
  notes: string;
  amount: number;
  type: string;
  import_id: string | null;
  text_enc: number;
};

async function rawRows(profileId: number): Promise<Raw[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, date, description, beneficiary, payor, notes, amount, type, import_id, text_enc
       FROM transactions WHERE profile_id = ? ORDER BY id`
  )
    .bind(profileId)
    .all<Raw>();
  return results;
}

/** Stored rows opened under the forced key — what the API would show. */
async function openedRows(profileId: number, owner: number): Promise<Omit<Raw, 'text_enc'>[]> {
  return openRows(new DataKeyring(KEYED), owner, 'transactions', await rawRows(profileId));
}

/** A row as the backfill has not reached it yet: plaintext at text_enc 0. */
async function seedPlain(
  profileId: number,
  rows: Array<[date: string, description: string, amount: number, type: string]>
): Promise<void> {
  await env.DB.batch(
    rows.map(([date, description, amount, type]) =>
      env.DB.prepare(
        "INSERT INTO transactions (description, amount, date, type, currency, profile_id, text_enc) VALUES (?, ?, ?, ?, 'EUR', ?, 0)"
      ).bind(description, amount, date, type, profileId)
    )
  );
}

async function execute(
  user: number,
  profileId: number,
  workerEnv: Env,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, any> }> {
  const cookie = (await issueSessionCookie(user, 'password', env)).split(';')[0];
  const res = await app.fetch(
    new Request('https://example.com/api/import/execute', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Profile-Id': String(profileId),
      },
      body: JSON.stringify({ defaultCurrency: 'EUR', ...body }),
    }),
    workerEnv,
    createExecutionContext()
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const sealed = (v: unknown) => typeof v === 'string' && v.startsWith(TEXT_PREFIX);

describe('import with a master key: sealing new rows', () => {
  it('seals the four text columns, leaves empty ones empty, and keeps the response plaintext', async () => {
    const res = await execute(USER, PROFILE, KEYED, {
      rows: [
        ['2026-05-01', 'Konzum', '-12.50', 'Konzum d.d.', 'Main account', 'weekly shop'],
        ['2026-05-02', 'Coffee', '-3', '', '', ''],
        // A JSON number where text is expected: stored as the text the cell showed.
        ['2026-05-03', 1234, '-1', '', '', ''],
      ],
      mapping: { date: 0, description: 1, amount: 2, beneficiary: 3, payor: 4, notes: 5 },
    });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(3);
    expect(JSON.stringify(res.body)).not.toContain(TEXT_PREFIX);

    const raw = await rawRows(PROFILE);
    expect(raw.map((r) => r.text_enc)).toEqual([1, 1, 1]);
    const [full, sparse, numeric] = raw;
    for (const col of ['description', 'beneficiary', 'payor', 'notes'] as const) {
      expect(sealed(full![col]), col).toBe(true);
    }
    expect(JSON.stringify(raw)).not.toContain('Konzum');
    // '' is stored unsealed on purpose, so the column DEFAULT stays safe in a sealed row.
    expect(sealed(sparse!.description)).toBe(true);
    expect([sparse!.beneficiary, sparse!.payor, sparse!.notes]).toEqual(['', '', '']);
    expect(sealed(numeric!.description)).toBe(true);

    const opened = await openedRows(PROFILE, USER);
    expect(opened.map((r) => [r.description, r.beneficiary, r.payor, r.notes])).toEqual([
      ['Konzum', 'Konzum d.d.', 'Main account', 'weekly shop'],
      ['Coffee', '', '', ''],
      ['1234', '', '', ''],
    ]);
  });

  it('stores a non-text cell exactly as a keyless import does', async () => {
    const body = {
      rows: [
        ['2026-05-03', 1234, '-1', '', '', true],
        ['2026-05-04', 12.5, '-2', 0.1, '', false],
        // What a formula or a running balance can hold: float noise past the 15th digit.
        ['2026-05-05', 0.1 + 0.2, '-3', 1234.5600000000002, '', ''],
      ],
      mapping: { date: 0, description: 1, amount: 2, beneficiary: 3, payor: 4, notes: 5 },
    };
    expect((await execute(PARITY_USER, PARITY_PROFILE, KEYLESS, body)).status).toBe(200);
    expect((await execute(USER, PROFILE, KEYED, body)).status).toBe(200);
    const text = (r: Omit<Raw, 'text_enc'>) => [r.description, r.beneficiary, r.payor, r.notes];
    const plain = (await rawRows(PARITY_PROFILE)).map(text);
    // As the cell showed it, in either mode: never D1's REAL rendering ('1234.0'), and to the 15
    // significant digits SQLite renders a REAL with, so 0.1 + 0.2 is '0.3'.
    expect(plain.map((r) => r[0])).toEqual(['1234', '12.5', '0.3']);
    expect(plain.map((r) => r[1])).toEqual(['', '0.1', '1234.56']);
    expect(plain.map((r) => r[3])).toEqual(['true', '', '']);
    expect((await openedRows(PROFILE, USER)).map(text)).toEqual(plain);
  });

  it('a dry run inserts nothing and does not mint a data key just to count', async () => {
    const res = await execute(USER, PROFILE, KEYED, {
      rows: [['2026-05-01', 'Konzum', '-12.50']],
      mapping: { date: 0, description: 1, amount: 2 },
      dry_run: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(await rawRows(PROFILE)).toEqual([]);
    const user = await env.DB.prepare('SELECT dek_wrapped FROM users WHERE id = ?')
      .bind(USER)
      .first<{ dek_wrapped: string | null }>();
    expect(user?.dek_wrapped).toBeNull();
  });
});

describe('import with a master key: duplicate detection over sealed and plaintext rows', () => {
  const MAPPING = { date: 0, description: 1, amount: 2 };
  // min 2026-04-01 and max 2026-04-05: the boundary dates of the bounded dedup read both match.
  const AGAIN = [
    ['2026-04-01', 'RENT', '-900'], // plaintext stored row, different case
    ['2026-04-02', 'Salary', '2000'], // sealed stored row
    ['2026-04-03', 'gym', '-30'], // plaintext stored row with stray whitespace
    ['2026-04-05', ' coffee', '-3'], // sealed stored row, different case and whitespace
    ['2026-04-04', 'Books', '-20'], // new
    ['2026-04-05', 'Coffee', '-4'], // same key, different amount: new
  ];

  async function scenario(user: number, profileId: number, workerEnv: Env) {
    await seedPlain(profileId, [
      ['2026-04-01', 'Rent', 900, 'expense'],
      ['2026-04-03', '  Gym ', 30, 'expense'],
      // Outside the incoming range: can never match, and is not read.
      ['2026-03-31', 'Rent', 900, 'expense'],
    ]);
    const first = await execute(user, profileId, workerEnv, {
      rows: [
        ['2026-04-02', 'Salary', '2000'],
        ['2026-04-05', 'Coffee', '-3'],
      ],
      mapping: MAPPING,
    });
    const preview = await execute(user, profileId, workerEnv, {
      rows: AGAIN,
      mapping: MAPPING,
      dry_run: true,
    });
    const second = await execute(user, profileId, workerEnv, { rows: AGAIN, mapping: MAPPING });
    const stored = (await openedRows(profileId, user)).map((r) => [
      r.date,
      r.description,
      r.amount,
      r.type,
    ]);
    return { first: first.body, preview: preview.body, second: second.body, stored };
  }

  it('finds exactly the duplicates the same import finds with no key', async () => {
    const keyed = await scenario(USER, PROFILE, KEYED);
    const plain = await scenario(PARITY_USER, PARITY_PROFILE, KEYLESS);

    expect(keyed.second.duplicates).toBe(4);
    expect(keyed.second.duplicate_indices).toEqual([0, 1, 2, 3]);
    expect(keyed.second.imported).toBe(2);
    expect(keyed.preview.duplicates).toBe(4);
    expect(keyed.preview.duplicate_indices).toEqual([0, 1, 2, 3]);
    expect(keyed.preview.imported).toBe(2);

    expect(keyed).toEqual(plain);

    // The seeded rows keep their form (only the backfill converts a row); every imported one is
    // sealed. With no key nothing is.
    const raw = await rawRows(PROFILE);
    expect(raw.map((r) => [r.date, r.text_enc])).toEqual([
      ['2026-04-01', 0],
      ['2026-04-03', 0],
      ['2026-03-31', 0],
      ['2026-04-02', 1],
      ['2026-04-05', 1],
      ['2026-04-04', 1],
      ['2026-04-05', 1],
    ]);
    expect(raw.filter((r) => r.text_enc === 1).every((r) => sealed(r.description))).toBe(true);
    expect((await rawRows(PARITY_PROFILE)).every((r) => r.text_enc === 0)).toBe(true);
  });

  it('a retry with the same importId does not count its own sealed rows as duplicates', async () => {
    const body = {
      rows: [
        ['2026-04-10', 'Pharmacy', '-8'],
        ['2026-04-11', 'Pharmacy', '-8'],
      ],
      mapping: MAPPING,
      importId: 'enc-retry-1',
    };
    const first = await execute(USER, PROFILE, KEYED, body);
    const retry = await execute(USER, PROFILE, KEYED, body);
    expect([first.body.imported, retry.body.imported, retry.body.duplicates]).toEqual([2, 2, 0]);
    const raw = await rawRows(PROFILE);
    expect(raw).toHaveLength(2);
    expect(raw.every((r) => r.text_enc === 1 && sealed(r.description))).toBe(true);
  });
});

describe('import with a master key: fails closed', () => {
  it('aborts rather than treat a stored value that will not open as a non-match', async () => {
    // A real import first, so the user has a key and the failure is the value, not the key.
    const minted = await execute(BROKEN_USER, BROKEN_PROFILE, KEYED, {
      rows: [['2026-06-10', 'Fuel', '-60']],
      mapping: { date: 0, description: 1, amount: 2 },
    });
    expect(minted.status).toBe(200);
    await env.DB.prepare(
      "INSERT INTO transactions (description, amount, date, type, currency, profile_id, text_enc) VALUES ('tc1.not-a-sealed-value', 5, '2026-06-01', 'expense', 'EUR', ?, 1)"
    )
      .bind(BROKEN_PROFILE)
      .run();

    for (const dryRun of [true, false]) {
      const res = await execute(BROKEN_USER, BROKEN_PROFILE, KEYED, {
        rows: [['2026-06-01', 'Anything', '-5']],
        mapping: { date: 0, description: 1, amount: 2 },
        dry_run: dryRun,
      });
      expect(res.status, `dry_run ${dryRun}`).toBeGreaterThanOrEqual(500);
    }
    expect(await rawRows(BROKEN_PROFILE)).toHaveLength(2);

    // The dedup read is bounded by the incoming dates, so an import that cannot match the broken
    // row never opens it.
    const outside = await execute(BROKEN_USER, BROKEN_PROFILE, KEYED, {
      rows: [['2026-07-01', 'Anything', '-5']],
      mapping: { date: 0, description: 1, amount: 2 },
    });
    expect(outside.status).toBe(200);
    expect(outside.body.imported).toBe(1);
  });
});

describe('daily sheet sync with a master key', () => {
  const HEADERS = 'Date,Description,Amount';

  async function addSource(profileId: number, sheetId: string, body: string): Promise<void> {
    sheets.set(sheetId, body);
    await env.DB.prepare(
      `INSERT INTO import_sources (profile_id, kind, label, config, mapping, category_types, schedule)
       VALUES (?, 'google_sheet', ?, ?, ?, NULL, 'daily')`
    )
      .bind(
        profileId,
        `sheet ${sheetId}`,
        JSON.stringify({ url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` }),
        JSON.stringify({ date: 'Date', description: 'Description', amount: 'Amount' })
      )
      .run();
  }

  const logsFor = async (profileId: number) =>
    (
      await env.DB.prepare(
        'SELECT imported, duplicates_skipped FROM import_logs WHERE profile_id = ? ORDER BY id'
      )
        .bind(profileId)
        .all<{ imported: number; duplicates_skipped: number }>()
    ).results;

  it('seals what it imports, and a re-run of an unchanged sheet imports nothing', async () => {
    // Groceries already exists as a plaintext row the backfill has not reached.
    await seedPlain(SYNC_PROFILE, [['2026-03-03', 'Groceries', 50, 'income']]);
    const rows = ['2026-03-01,Coffee,4.50', '2026-03-02,Rent,900.00', '2026-03-03,groceries,50'];
    await addSource(SYNC_PROFILE, 'enc-sync-sheet', [HEADERS, ...rows].join('\n'));

    await runScheduledSheetSyncs(DAILY_CRON, KEYED);
    await runScheduledSheetSyncs(DAILY_CRON, KEYED);

    const raw = await rawRows(SYNC_PROFILE);
    expect(raw.map((r) => r.text_enc)).toEqual([0, 1, 1]);
    expect(raw.slice(1).every((r) => sealed(r.description))).toBe(true);
    expect((await openedRows(SYNC_PROFILE, SYNC_USER)).map((r) => r.description)).toEqual([
      'Groceries',
      'Coffee',
      'Rent',
    ]);
    // One session: the first run's. The second found every row already there.
    expect(await logsFor(SYNC_PROFILE)).toEqual([{ imported: 2, duplicates_skipped: 1 }]);

    sheets.set('enc-sync-sheet', [HEADERS, ...rows, '2026-03-04,Books,20'].join('\n'));
    await runScheduledSheetSyncs(DAILY_CRON, KEYED);
    expect((await openedRows(SYNC_PROFILE, SYNC_USER)).map((r) => r.description)).toEqual([
      'Groceries',
      'Coffee',
      'Rent',
      'Books',
    ]);
  });

  it('leaves a profile nobody owns in plaintext, and still dedups it', async () => {
    await addSource(
      LEGACY_PROFILE,
      'enc-legacy-sheet',
      [HEADERS, '2026-03-01,Coffee,4.50', '2026-03-02,Rent,900.00'].join('\n')
    );
    await runScheduledSheetSyncs(DAILY_CRON, KEYED);
    await runScheduledSheetSyncs(DAILY_CRON, KEYED);

    const raw = await rawRows(LEGACY_PROFILE);
    expect(raw.map((r) => [r.description, r.text_enc])).toEqual([
      ['Coffee', 0],
      ['Rent', 0],
    ]);
    expect(await logsFor(LEGACY_PROFILE)).toEqual([{ imported: 2, duplicates_skipped: 0 }]);
  });
});

describe('email-in with a master key', () => {
  const EMAIL_ENV = {
    ...KEYED,
    EMAIL_INGEST_SECRET: 'enc-ingest-secret',
    EMAIL_INGEST_PROFILE_ID: String(EMAIL_PROFILE),
    EMAIL_INGEST_ALLOWED_SENDERS: '',
  } as unknown as Env;

  function forwarded(csv: string) {
    const mime = [
      'From: bank@example.com',
      'To: ingest+enc-ingest-secret@example.com',
      'Subject: Statement',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="enc-boundary"',
      '',
      '--enc-boundary',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Statement attached.',
      '--enc-boundary',
      'Content-Type: text/csv; name="statement.csv"',
      'Content-Disposition: attachment; filename="statement.csv"',
      'Content-Transfer-Encoding: base64',
      '',
      btoa(csv),
      '--enc-boundary--',
      '',
    ].join('\r\n');
    const setReject = vi.fn();
    const message = {
      from: 'bank@example.com',
      to: 'ingest+enc-ingest-secret@example.com',
      raw: new Response(mime).body!,
      setReject,
    } as unknown as ForwardableEmailMessage;
    return { message, setReject };
  }

  it('seals the attachment rows, and a re-forwarded statement adds nothing', async () => {
    const csv = 'Date,Description,Amount\n2026-07-01,Coffee,-4.50\n2026-07-02,Salary,1000\n';
    const first = forwarded(csv);
    await handleIngestEmail(first.message, EMAIL_ENV);
    expect(first.setReject).not.toHaveBeenCalled();
    const again = forwarded(csv);
    await handleIngestEmail(again.message, EMAIL_ENV);
    expect(again.setReject).not.toHaveBeenCalled();

    const raw = await rawRows(EMAIL_PROFILE);
    expect(raw).toHaveLength(2);
    expect(raw.every((r) => r.text_enc === 1 && sealed(r.description))).toBe(true);
    expect((await openedRows(EMAIL_PROFILE, EMAIL_USER)).map((r) => r.description)).toEqual([
      'Coffee',
      'Salary',
    ]);
    const logs = await env.DB.prepare(
      'SELECT imported, duplicates_skipped FROM import_logs WHERE profile_id = ? ORDER BY id'
    )
      .bind(EMAIL_PROFILE)
      .all();
    expect(logs.results).toEqual([
      { imported: 2, duplicates_skipped: 0 },
      { imported: 0, duplicates_skipped: 2 },
    ]);
  });
});
