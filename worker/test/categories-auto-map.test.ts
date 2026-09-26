/**
 * POST /api/categories/auto-map — category suggestions for uncategorised transactions — over
 * sealed text (field encryption).
 *
 * The same ledger is seeded twice: all plaintext in one profile, read through an explicitly
 * keyless env (the SQL LIKE path, byte-for-byte what shipped before encryption), and as a mix of
 * sealed and plaintext rows in another, read through a forced key (the JS path). The two must
 * suggest the same thing. A learned mapping on "tc1" — the prefix of every sealed value — is the
 * probe: scoring ciphertext would propose it for every sealed row.
 */
import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { DataKeyring } from '../src/data-keys';
import app from '../src/index';
import { sealForInsert } from '../src/sealed-rows';

const KEK = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { ...env, DATA_KEK_1: KEK };
// Keyless whatever mode the suite runs in.
const KEYLESS = { ...env, DATA_KEK_1: undefined };

// Read only through KEYLESS and SELF; auto-map never writes a sealed column, so it never gets a key.
const PLAIN_USER = 54100;
const PLAIN_PROFILE = 54100;
// Only ever through KEYED.
const SEALED_USER = 54101;
const SEALED_PROFILE = 54101;

const CATEGORY_NAMES = ['Streaming', 'Dining', 'Groceries', 'Probe'] as const;
type CategoryName = (typeof CATEGORY_NAMES)[number];
const categoryIds = (base: number): Record<CategoryName, number> =>
  Object.fromEntries(CATEGORY_NAMES.map((name, i) => [name, base + i])) as Record<
    CategoryName,
    number
  >;
const PLAIN_CATS = categoryIds(54110);
const SEALED_CATS = categoryIds(54120);

interface LedgerRow {
  sealed: boolean;
  description: string;
  beneficiary?: string;
  payor?: string;
  category?: CategoryName;
}

const LEDGER: LedgerRow[] = [
  { sealed: true, description: 'NETFLIX.COM 8841' },
  { sealed: false, description: 'Card payment 0192', beneficiary: 'Netflix International' },
  // Payor only: suggested from, but never found by the description filter (it reads
  // description and beneficiary, as the SQL did).
  { sealed: true, description: 'Refund', payor: 'netflix billing' },
  { sealed: false, description: 'KROGER #120' },
  { sealed: true, description: 'Card 7730', beneficiary: 'Starbucks Coffee' },
  // Already categorised: never a candidate.
  { sealed: true, description: 'Whole Foods', category: 'Groceries' },
  { sealed: false, description: 'Misc purchase' },
  { sealed: true, description: 'Plain purchase' },
];

interface Mapping {
  transaction_id: number;
  description: string;
  proposed_category_name: string;
  confidence: number;
}
interface AutoMap {
  total: number;
  mapped: number;
  mappings: Mapping[];
}

async function seed(
  profile: number,
  cats: Record<CategoryName, number>,
  owner: number | null
): Promise<number[]> {
  const ring = new DataKeyring(KEYED);
  const ids: number[] = [];
  for (const row of LEDGER) {
    const plain: Record<string, unknown> = {
      profile_id: profile,
      description: row.description,
      beneficiary: row.beneficiary ?? '',
      payor: row.payor ?? '',
      category_id: row.category ? cats[row.category] : null,
      amount: -12.5,
      type: 'expense',
      date: '2026-05-01',
    };
    const values =
      owner !== null && row.sealed
        ? await sealForInsert(ring, owner, 'transactions', plain)
        : plain;
    const cols = Object.keys(values);
    const res = await env.DB.prepare(
      `INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    )
      .bind(...cols.map((col) => (values as Record<string, unknown>)[col]))
      .run();
    ids.push(Number(res.meta.last_row_id));
  }
  return ids;
}

async function autoMap(target: 'plain' | 'sealed', body: unknown): Promise<AutoMap> {
  const [user, profile, bindings] =
    target === 'plain'
      ? [PLAIN_USER, PLAIN_PROFILE, KEYLESS]
      : [SEALED_USER, SEALED_PROFILE, KEYED];
  const cookie = (await issueSessionCookie(user, 'password', env)).split(';')[0];
  const res = await app.fetch(
    new Request('https://example.com/api/categories/auto-map', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Profile-Id': String(profile),
      },
      body: JSON.stringify(body),
    }),
    bindings,
    createExecutionContext()
  );
  expect(res.status).toBe(200);
  return res.json<AutoMap>();
}

/** The response without its ids, which differ between the two profiles. */
function summary(result: AutoMap) {
  return {
    total: result.total,
    mapped: result.mapped,
    mappings: result.mappings
      .map((m) => [m.description, m.proposed_category_name, m.confidence] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  };
}

beforeEach(async () => {
  for (const table of ['category_mappings', 'transactions', 'categories']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE profile_id IN (?, ?)`)
      .bind(PLAIN_PROFILE, SEALED_PROFILE)
      .run();
  }
  await env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)')
    .bind(PLAIN_PROFILE, SEALED_PROFILE)
    .run();
  await env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(PLAIN_USER, SEALED_USER).run();
  const stmts: D1PreparedStatement[] = [];
  for (const [user, profile, cats] of [
    [PLAIN_USER, PLAIN_PROFILE, PLAIN_CATS],
    [SEALED_USER, SEALED_PROFILE, SEALED_CATS],
  ] as const) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, ?, 'password', 1)"
      ).bind(user, `automap-${user}@example.com`),
      env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
        profile,
        user,
        'Main'
      )
    );
    for (const name of CATEGORY_NAMES) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, ?, 'expense', '#123')"
        ).bind(cats[name], profile, name)
      );
    }
    stmts.push(
      env.DB.prepare(
        'INSERT INTO category_mappings (profile_id, pattern, category_id, confidence, use_count) VALUES (?, ?, ?, 0.99, 5)'
      ).bind(profile, 'tc1', cats.Probe)
    );
  }
  await env.DB.batch(stmts);
});

describe('category auto-map over sealed text', () => {
  it('suggests from opened text by transaction id, as it does over plaintext', async () => {
    const plainIds = await seed(PLAIN_PROFILE, PLAIN_CATS, null);
    const sealedIds = await seed(SEALED_PROFILE, SEALED_CATS, SEALED_USER);
    for (const [i, row] of LEDGER.entries()) {
      const stored = await env.DB.prepare(
        'SELECT description, text_enc FROM transactions WHERE id = ?'
      )
        .bind(sealedIds[i])
        .first<{ description: string; text_enc: number }>();
      expect(stored!.text_enc).toBe(row.sealed ? 1 : 0);
      expect(stored!.description.startsWith('tc1.')).toBe(row.sealed);
    }

    const plain = await autoMap('plain', { transaction_ids: plainIds });
    const sealed = await autoMap('sealed', { transaction_ids: sealedIds });
    expect(summary(sealed)).toEqual(summary(plain));
    expect(sealed.total).toBe(7);

    const byDescription = Object.fromEntries(
      sealed.mappings.map((m) => [m.description, m.proposed_category_name])
    );
    expect(byDescription).toMatchObject({
      'NETFLIX.COM 8841': 'Streaming',
      'Card payment 0192': 'Streaming',
      Refund: 'Streaming',
      'KROGER #120': 'Groceries',
      'Card 7730': 'Dining',
    });
    expect(Object.values(byDescription)).not.toContain('Probe');
    for (const m of sealed.mappings) expect('text_enc' in m).toBe(false);
  });

  it('filters by description in JS exactly as the SQL LIKE does', async () => {
    await seed(PLAIN_PROFILE, PLAIN_CATS, null);
    await seed(SEALED_PROFILE, SEALED_CATS, SEALED_USER);
    const totals: Record<string, number> = {};
    for (const description of [
      'Net-flix!',
      'NETFLIX',
      'coffee',
      'kroger',
      'purchase',
      '!!!',
      'zzz',
    ]) {
      const body = { description, amount: 12.5 };
      const plain = await autoMap('plain', body);
      const sealed = await autoMap('sealed', body);
      expect({ description, ...summary(sealed) }).toEqual({ description, ...summary(plain) });
      totals[description] = sealed.total;
    }
    expect(totals).toEqual({
      'Net-flix!': 2, // description OR beneficiary; the payor-only refund is not found
      NETFLIX: 2,
      coffee: 1,
      kroger: 1,
      purchase: 2,
      '!!!': 7, // normalises to '' — LIKE '%%' keeps every candidate
      zzz: 0,
    });
  });

  it('filters by description the same way in whichever mode the suite runs', async () => {
    await seed(PLAIN_PROFILE, PLAIN_CATS, null);
    const cookie = (await issueSessionCookie(PLAIN_USER, 'password', env)).split(';')[0];
    const res = await SELF.fetch('https://example.com/api/categories/auto-map', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Profile-Id': String(PLAIN_PROFILE),
      },
      body: JSON.stringify({ description: 'Net-flix!', amount: 12.5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<AutoMap>();
    expect(body.total).toBe(2);
    expect(body.mappings.map((m) => m.description).sort()).toEqual([
      'Card payment 0192',
      'NETFLIX.COM 8841',
    ]);
  });

  it('fails closed on a sealed value that cannot be opened', async () => {
    const ids = await seed(SEALED_PROFILE, SEALED_CATS, SEALED_USER);
    const stored = await env.DB.prepare('SELECT description FROM transactions WHERE id = ?')
      .bind(ids[0])
      .first<{ description: string }>();
    const s = stored!.description;
    await env.DB.prepare('UPDATE transactions SET description = ? WHERE id = ?')
      .bind(s.slice(0, 10) + (s[10] === 'A' ? 'B' : 'A') + s.slice(11), ids[0])
      .run();
    const cookie = (await issueSessionCookie(SEALED_USER, 'password', env)).split(';')[0];
    const res = await app.fetch(
      new Request('https://example.com/api/categories/auto-map', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-Profile-Id': String(SEALED_PROFILE),
        },
        body: JSON.stringify({ transaction_ids: ids }),
      }),
      KEYED,
      createExecutionContext()
    );
    expect(res.status).toBe(500);
  });
});
