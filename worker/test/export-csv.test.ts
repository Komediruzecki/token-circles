import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { issueSessionCookie } from '../src/auth';
import { DataKeyring } from '../src/data-keys';
import { TEXT_PREFIX } from '../src/field-crypto';
import { sealForInsert } from '../src/sealed-rows';

// CSV export: the formula-injection guard must quote attacker-shaped STRINGS but leave
// plain numbers alone — it used to turn every negative balance into text ("'-2392.21").

let cookie = '';

beforeEach(async () => {
  for (const t of ['accounts', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (60, 'csv@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (600, 60, 'Main')"),
    env.DB.prepare(
      "INSERT INTO accounts (profile_id, name, type, currency, balance) VALUES (600, 'WRev', 'giro', 'USD', -2392.21)"
    ),
    env.DB.prepare(
      "INSERT INTO accounts (profile_id, name, type, currency, balance) VALUES (600, '=HYPERLINK(\"http://evil\")', 'giro', 'USD', 10)"
    ),
  ]);
  cookie = (await issueSessionCookie(60, 'password', env)).split(';')[0];
});

describe('GET /api/export/accounts (CSV)', () => {
  it('exports negative balances as plain numbers, not quoted text', async () => {
    const res = await SELF.fetch('https://example.com/api/export/accounts?format=csv', {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('-2392.21');
    expect(csv).not.toContain("'-2392.21");
  });

  it('still quotes formula-shaped strings', async () => {
    const res = await SELF.fetch('https://example.com/api/export/accounts?format=csv', {
      headers: { Cookie: cookie },
    });
    const csv = await res.text();
    expect(csv).toContain("'=HYPERLINK");
  });
});

// ── Sealed text columns (field encryption) ────────────────────────────────────
// The transactions and recurring exports carry sealed columns. They must come out as plaintext,
// with exactly the columns they always had: toCsv takes its header from the first row's keys, so a
// leftover text_enc would become a column of the user's file.

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { ...env, DATA_KEK_1: K };
const U_PLAIN = 53031;
const P_PLAIN = 530310;
const U_KEYED = 53032;
const P_KEYED = 530320;

const TX_HEADER =
  'date,description,amount,type,currency,means_of_payment,beneficiary,payor,notes,category';
const RECURRING_HEADER = 'description,amount,type,frequency,day_of_month,next_date,notes,active';

type Row = Record<string, unknown>;

async function insertRow(
  table: 'transactions' | 'recurring_transactions',
  values: Row
): Promise<void> {
  const cols = Object.keys(values);
  await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  )
    .bind(...cols.map((c) => values[c]))
    .run();
}

async function seedExportRows(profileId: number, sealedAlso: boolean): Promise<void> {
  const ring = new DataKeyring({ DB: env.DB, DATA_KEK_1: K });
  const put = async (
    table: 'transactions' | 'recurring_transactions',
    values: Row,
    seal: boolean
  ) => {
    const row = { ...values, profile_id: profileId };
    if (!(seal && sealedAlso)) return insertRow(table, row);
    const sealed = await sealForInsert(ring, U_KEYED, table, row);
    expect(sealed.text_enc).toBe(1);
    return insertRow(table, sealed);
  };
  await put(
    'transactions',
    {
      date: '2026-03-03',
      description: '+385 91 call',
      amount: 12.5,
      type: 'expense',
      currency: 'EUR',
      means_of_payment: 'card',
      beneficiary: 'A1 Hrvatska',
      payor: '',
      notes: 'line, "quoted"',
    },
    true
  );
  await put(
    'transactions',
    {
      date: '2026-03-02',
      description: 'Market',
      amount: 8,
      type: 'expense',
      currency: 'EUR',
      beneficiary: 'Placa',
    },
    false
  );
  await put(
    'transactions',
    {
      date: '2026-03-01',
      description: 'Refund',
      amount: 5,
      type: 'income',
      currency: 'EUR',
      payor: 'Shop d.o.o.',
    },
    true
  );
  await put(
    'recurring_transactions',
    {
      description: 'Netflix',
      amount: 17.99,
      type: 'expense',
      frequency: 'monthly',
      day_of_month: 5,
      next_date: '2026-04-05',
      notes: 'family plan',
    },
    true
  );
  await put(
    'recurring_transactions',
    {
      description: 'Gym',
      amount: 30,
      type: 'expense',
      frequency: 'monthly',
      day_of_month: 1,
      next_date: '2026-04-01',
    },
    false
  );
}

const TX_CSV = [
  TX_HEADER,
  `2026-03-03,'+385 91 call,12.5,expense,EUR,card,A1 Hrvatska,,"line, ""quoted""",`,
  '2026-03-02,Market,8,expense,EUR,,Placa,,,',
  '2026-03-01,Refund,5,income,EUR,,,Shop d.o.o.,,',
].join('\n');

const TX_JSON = [
  {
    date: '2026-03-03',
    description: '+385 91 call',
    amount: 12.5,
    type: 'expense',
    currency: 'EUR',
    means_of_payment: 'card',
    beneficiary: 'A1 Hrvatska',
    payor: '',
    notes: 'line, "quoted"',
    category: null,
  },
  {
    date: '2026-03-02',
    description: 'Market',
    amount: 8,
    type: 'expense',
    currency: 'EUR',
    means_of_payment: '',
    beneficiary: 'Placa',
    payor: '',
    notes: '',
    category: null,
  },
  {
    date: '2026-03-01',
    description: 'Refund',
    amount: 5,
    type: 'income',
    currency: 'EUR',
    means_of_payment: '',
    beneficiary: '',
    payor: 'Shop d.o.o.',
    notes: '',
    category: null,
  },
];

const RECURRING_JSON = [
  {
    description: 'Gym',
    amount: 30,
    type: 'expense',
    frequency: 'monthly',
    day_of_month: 1,
    next_date: '2026-04-01',
    notes: '',
    active: 1,
  },
  {
    description: 'Netflix',
    amount: 17.99,
    type: 'expense',
    frequency: 'monthly',
    day_of_month: 5,
    next_date: '2026-04-05',
    notes: 'family plan',
    active: 1,
  },
];

/** The recurring export has no ORDER BY: compare its rows in a fixed order. */
function sortedRecurringCsv(csv: string): string[] {
  const [header, ...rows] = csv.split('\n');
  return [header, ...rows.sort()];
}
const RECURRING_CSV = [
  RECURRING_HEADER,
  'Gym,30,expense,monthly,1,2026-04-01,,1',
  'Netflix,17.99,expense,monthly,5,2026-04-05,family plan,1',
];

async function expectExports(fetchPath: (path: string) => Promise<Response>): Promise<void> {
  const csv = await fetchPath('/api/export/transactions?format=csv');
  expect(csv.status).toBe(200);
  expect(await csv.text()).toBe(TX_CSV);

  const json = await fetchPath('/api/export/transactions?format=json');
  expect(json.status).toBe(200);
  expect(await json.json()).toEqual(TX_JSON);

  const rcsv = await fetchPath('/api/export/recurring?format=csv');
  expect(rcsv.status).toBe(200);
  expect(sortedRecurringCsv(await rcsv.text())).toEqual(RECURRING_CSV);

  const rjson = await fetchPath('/api/export/recurring?format=json');
  expect(rjson.status).toBe(200);
  const recurring = (await rjson.json()) as Row[];
  expect(
    [...recurring].sort((a, b) => (String(a.description) < String(b.description) ? -1 : 1))
  ).toEqual(RECURRING_JSON);
}

describe('GET /api/export/{transactions,recurring} — sealed text columns', () => {
  beforeEach(async () => {
    for (const table of ['transactions', 'recurring_transactions']) {
      await env.DB.prepare(`DELETE FROM ${table} WHERE profile_id IN (?, ?)`)
        .bind(P_PLAIN, P_KEYED)
        .run();
    }
    await env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(P_PLAIN, P_KEYED).run();
    await env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(U_PLAIN, U_KEYED).run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'csv-plain@example.com', 'password', 1)"
      ).bind(U_PLAIN),
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'csv-keyed@example.com', 'password', 1)"
      ).bind(U_KEYED),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
        P_PLAIN,
        U_PLAIN
      ),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
        P_KEYED,
        U_KEYED
      ),
    ]);
  });

  it('exports plaintext rows with exactly the original columns, whichever mode the suite runs in', async () => {
    await seedExportRows(P_PLAIN, false);
    const plainCookie = (await issueSessionCookie(U_PLAIN, 'password', env)).split(';')[0];
    await expectExports((path) =>
      SELF.fetch(`https://example.com${path}`, {
        headers: { Cookie: plainCookie, 'X-Profile-Id': String(P_PLAIN) },
      })
    );
  });

  it('with a key: exports a mix of sealed and plaintext rows as plaintext, with no text_enc column', async () => {
    await seedExportRows(P_KEYED, true);
    const raw = (
      await env.DB.prepare(
        `SELECT description, notes FROM transactions WHERE profile_id = ? AND text_enc = 1
         UNION ALL
         SELECT description, notes FROM recurring_transactions WHERE profile_id = ? AND text_enc = 1`
      )
        .bind(P_KEYED, P_KEYED)
        .all<{ description: string; notes: string }>()
    ).results;
    expect(raw).toHaveLength(3);
    for (const r of raw) expect(r.description.startsWith(TEXT_PREFIX)).toBe(true);

    const keyedCookie = (await issueSessionCookie(U_KEYED, 'password', env)).split(';')[0];
    await expectExports((path) =>
      app.fetch(
        new Request(`https://example.com${path}`, {
          headers: { Cookie: keyedCookie, 'X-Profile-Id': String(P_KEYED) },
        }),
        KEYED,
        createExecutionContext()
      )
    );
  });
});
