/**
 * Bills, recurring rules and the bills reminder email with field encryption FORCED on, whatever
 * mode the suite runs in: bills.name/notes and recurring_transactions.description/notes are
 * sealed at rest, every API response still carries plaintext, the name sorts that moved from SQL
 * to JS give exactly the order SQL gave, and paying a bill / populating a rule seals the new
 * transaction's text afresh for the transactions table.
 *
 * Users here only ever go through KEYED (or, for U2, hold no key at all), so the suite's own
 * TEST_DATA_KEK — or its absence — never meets a key wrapped under K.
 */
import app from '../src/index';
import { createExecutionContext, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { DataKeyring, DataKeyUnavailableError } from '../src/data-keys';
import { TEXT_PREFIX } from '../src/field-crypto';
import { composeReminderPreview, runScheduledReminders } from '../src/reminders';
import { openRows, sealForInsert, type SealedTable } from '../src/sealed-rows';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { ...env, DATA_KEK_1: K };
const { DATA_KEK_1: _suiteKek, ...KEYLESS } = env as typeof env & { DATA_KEK_1?: string };

const U = 55001; // holds a data key (under K)
const P = 55011;
const U2 = 55002; // never gets a key: every row plaintext, read through KEYED and KEYLESS alike
const P2 = 55012;
const EMAIL = 'sealed-bills@example.com';

type Row = Record<string, unknown>;
type Env = typeof KEYED | typeof KEYLESS;

const cookies: Record<number, string> = {};
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  for (const pid of [P, P2]) {
    for (const t of ['transactions', 'bills', 'recurring_transactions', 'settings']) {
      await env.DB.prepare(`DELETE FROM ${t} WHERE profile_id = ?`).bind(pid).run();
    }
  }
  await env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(P, P2).run();
  for (const t of ['reminder_dedup', 'reminder_sends']) {
    await env.DB.prepare(`DELETE FROM ${t} WHERE user_id IN (?, ?)`).bind(U, U2).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(U, U2).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, ?, 'password', 1, 'basic')"
    ).bind(U, EMAIL),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'sealed-bills-2@example.com', 'password', 1)"
    ).bind(U2),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(P, U),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(P2, U2),
  ]);
  cookies[U] = (await issueSessionCookie(U, 'password', env)).split(';')[0];
  cookies[U2] = (await issueSessionCookie(U2, 'password', env)).split(';')[0];
});

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  opts: { user?: number; env?: Env } = {}
): Promise<Response> {
  const user = opts.user ?? U;
  return app.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: {
        Cookie: cookies[user]!,
        'Content-Type': 'application/json',
        'X-Profile-Id': String(user === U ? P : P2),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    opts.env ?? KEYED,
    createExecutionContext()
  );
}

async function json<T = unknown>(res: Promise<Response>): Promise<T> {
  const r = await res;
  expect(r.status).toBe(200);
  const body = (await r.json()) as T;
  // Response shapes are unchanged: no marker, and never ciphertext.
  expect(JSON.stringify(body)).not.toContain('text_enc');
  expect(JSON.stringify(body)).not.toContain(TEXT_PREFIX);
  return body;
}

async function raw(sql: string, ...params: unknown[]): Promise<Row[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...params)
      .all<Row>()
  ).results;
}

/** Raw rows opened under K — the helper in test/helpers/sealed.ts opens under the suite's key. */
async function opened(table: SealedTable, sql: string, ...params: unknown[]): Promise<Row[]> {
  return openRows(new DataKeyring(KEYED), U, table, await raw(sql, ...params), {
    keepMarker: true,
  });
}

/** Seed a row directly: sealed under U's key, or plaintext at text_enc 0 (not yet backfilled). */
async function seed(
  table: 'bills' | 'recurring_transactions',
  values: Row,
  sealed: boolean
): Promise<number> {
  const row: Row = sealed
    ? await sealForInsert(new DataKeyring(KEYED), U, table, values)
    : { ...values, text_enc: 0 };
  const cols = Object.keys(row);
  const res = await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  )
    .bind(...cols.map((c) => row[c]))
    .run();
  return Number(res.meta.last_row_id);
}

const isSealed = (v: unknown) => typeof v === 'string' && v.startsWith(TEXT_PREFIX);

describe('bills with encryption on', () => {
  it('seals name and notes on create, and every read returns plaintext', async () => {
    const { id } = await json<{ id: number }>(
      call('POST', '/api/bills', {
        name: 'Sealed Rent',
        amount: 900,
        frequency: 'monthly',
        dueDate: day(2),
        notes: 'landlord',
      })
    );
    const plainId = await seed(
      'bills',
      { profile_id: P, name: 'Plain Phone', amount: 20, due_date: day(3), notes: 'mobile' },
      false
    );

    const [stored] = await raw('SELECT name, notes, text_enc FROM bills WHERE id = ?', id);
    expect(stored!.text_enc).toBe(1);
    expect(isSealed(stored!.name)).toBe(true);
    expect(isSealed(stored!.notes)).toBe(true);
    expect(String(stored!.name)).not.toContain('Rent');

    const one = await json<Row>(call('GET', `/api/bills/${id}`));
    expect(one).toMatchObject({ name: 'Sealed Rent', notes: 'landlord' });
    expect(await json<Row>(call('GET', `/api/bills/${plainId}`))).toMatchObject({
      name: 'Plain Phone',
      notes: 'mobile',
    });

    const list = await json<Row[]>(call('GET', '/api/bills'));
    expect(list.map((b) => [b.name, b.notes])).toEqual([
      ['Plain Phone', 'mobile'],
      ['Sealed Rent', 'landlord'],
    ]);

    const summary = await json<{ bills: Row[] }>(call('GET', '/api/bills/summary'));
    expect(summary.bills.map((b) => b.name).sort()).toEqual(['Plain Phone', 'Sealed Rent']);

    const notifications = await json<{ notifications: Row[] }>(
      call('GET', '/api/bills/notifications')
    );
    expect(notifications.notifications.map((b) => b.name).sort()).toEqual([
      'Plain Phone',
      'Sealed Rent',
    ]);

    const calendar = await json<{ days: Record<string, Row[]> }>(
      call('GET', '/api/bills/calendar')
    );
    expect(
      Object.values(calendar.days)
        .flat()
        .map((b) => b.name)
        .sort()
    ).toEqual(['Plain Phone', 'Sealed Rent']);

    const upcoming = await json<Row[]>(call('GET', '/api/bills/upcoming'));
    expect(upcoming.map((b) => b.name).sort()).toEqual(['Plain Phone', 'Sealed Rent']);
  });

  it('sorts GET /api/bills by is_active then name in BINARY order, sealed and plain mixed', async () => {
    const names: Array<[string, number, boolean]> = [
      ['water', 1, true],
      ['Banana gym', 1, false],
      ['Äpfel', 1, true],
      ['Zeta rent', 1, false],
      ['apple tv', 1, true],
      ['', 1, false],
      ['10 storage', 1, true],
      ['9 storage', 1, false],
      ['aaa old', 0, true],
      ['Aardvark old', 0, false],
    ];
    for (const [name, is_active, sealed] of names) {
      await seed('bills', { profile_id: P, name, amount: 1, is_active, due_date: day(40) }, sealed);
    }
    const list = await json<Row[]>(call('GET', '/api/bills'));
    expect(list.map((b) => b.name)).toEqual([
      '',
      '10 storage',
      '9 storage',
      'Banana gym',
      'Zeta rent',
      'apple tv',
      'water',
      'Äpfel',
      'Aardvark old',
      'aaa old',
    ]);
  });

  it('gives the same bill order and upcoming tiebreak as the keyless SQL', async () => {
    // U2 holds no key: all rows plaintext. KEYLESS runs the original ORDER BY b.name; KEYED runs
    // the JS sort. Same rows, so the responses must be identical.
    const rows: Array<[string, number, string]> = [
      ['water', 1, 'monthly'],
      ['Electric', 1, 'monthly'],
      ['gas', 1, 'monthly'],
      ['Internet', 1, 'monthly'],
      ['Élan', 1, 'monthly'],
      ['', 1, 'monthly'],
      ['zoo', 0, 'monthly'],
      ['Alpha', 0, 'yearly'],
      ['beta weekly', 1, 'weekly'],
      ['Omega weekly', 1, 'weekly'],
      ['once', 1, 'once'],
      ['Also once', 1, 'once'],
    ];
    for (const [name, is_active, frequency] of rows) {
      await env.DB.prepare(
        'INSERT INTO bills (profile_id, name, amount, is_active, frequency, day_of_month, due_date) VALUES (?, ?, 10, ?, ?, 15, ?)'
      )
        .bind(P2, name, is_active, frequency, day(20))
        .run();
    }
    for (const path of ['/api/bills', '/api/bills/upcoming', '/api/bills?type=bill']) {
      const keyless = await json(call('GET', path, undefined, { user: U2, env: KEYLESS }));
      const keyed = await json(call('GET', path, undefined, { user: U2, env: KEYED }));
      expect(keyed).toEqual(keyless);
    }
    const upcoming = await json<Row[]>(call('GET', '/api/bills/upcoming', undefined, { user: U2 }));
    const monthly = upcoming.filter((b) => b.frequency === 'monthly').map((b) => b.name);
    expect(monthly).toEqual(['', 'Electric', 'Internet', 'gas', 'water', 'Élan']);
    // U2's reads never created a key.
    expect(
      (await raw('SELECT dek_wrapped FROM users WHERE id = ?', U2))[0]!.dek_wrapped
    ).toBeNull();
  });

  it('breaks same-day upcoming ties by name across sealed and plain rows', async () => {
    const rows: Array<[string, boolean]> = [
      ['water', true],
      ['Electric', false],
      ['gas', true],
      ['Internet', false],
    ];
    for (const [name, sealed] of rows) {
      await seed(
        'bills',
        {
          profile_id: P,
          name,
          amount: 5,
          frequency: 'monthly',
          day_of_month: 15,
          due_date: day(20),
        },
        sealed
      );
    }
    const upcoming = await json<Row[]>(call('GET', '/api/bills/upcoming'));
    expect(upcoming.map((b) => b.name)).toEqual(['Electric', 'Internet', 'gas', 'water']);
  });

  it('updates sealed text in the form the row is in, and leaves unsent text untouched', async () => {
    const { id } = await json<{ id: number }>(
      call('POST', '/api/bills', { name: 'Hosting', amount: 20, dueDate: day(5), notes: 'prod' })
    );
    const before = (await raw('SELECT name, notes FROM bills WHERE id = ?', id))[0]!;

    await json(call('PUT', `/api/bills/${id}`, { autopay: true, amount: 25 }));
    const untouched = (
      await raw('SELECT name, notes, text_enc, amount FROM bills WHERE id = ?', id)
    )[0]!;
    // Not re-sealed: the exact stored ciphertext survives a PUT that did not send the text.
    expect(untouched).toMatchObject({
      name: before.name,
      notes: before.notes,
      text_enc: 1,
      amount: 25,
    });

    await json(call('PUT', `/api/bills/${id}`, { name: 'Hosting v2' }));
    const [renamed] = await opened(
      'bills',
      'SELECT name, notes, text_enc FROM bills WHERE id = ?',
      id
    );
    expect(renamed).toMatchObject({ name: 'Hosting v2', notes: 'prod', text_enc: 1 });
    const rawRenamed = (await raw('SELECT name, notes FROM bills WHERE id = ?', id))[0]!;
    expect(isSealed(rawRenamed.name)).toBe(true);
    expect(rawRenamed.notes).toBe(before.notes);
    expect(await json<Row>(call('GET', `/api/bills/${id}`))).toMatchObject({
      name: 'Hosting v2',
      notes: 'prod',
      autopay: true,
    });

    // A plaintext row (not yet backfilled) stays plaintext: only the backfill changes its form.
    const plainId = await seed(
      'bills',
      { profile_id: P, name: 'Plain Gym', amount: 30, due_date: day(9), notes: 'old' },
      false
    );
    await json(call('PUT', `/api/bills/${plainId}`, { name: 'Plain Gym renamed', notes: 'new' }));
    expect((await raw('SELECT name, notes, text_enc FROM bills WHERE id = ?', plainId))[0]).toEqual(
      {
        name: 'Plain Gym renamed',
        notes: 'new',
        text_enc: 0,
      }
    );
  });

  it('mark-paid seals the new transaction afresh, from a sealed or a plaintext bill', async () => {
    const { id } = await json<{ id: number }>(
      call('POST', '/api/bills', {
        name: 'Electric',
        amount: 70,
        dueDate: day(1),
        notes: 'meter 4',
      })
    );
    const plainId = await seed(
      'bills',
      { profile_id: P, name: 'Plain Water', amount: 15, due_date: day(1), notes: '' },
      false
    );
    for (const billId of [id, plainId]) {
      const res = await json<{ transactionId: number }>(
        call('POST', `/api/bills/${billId}/mark-paid`, {})
      );
      expect(res.transactionId).toBeGreaterThan(0);
    }
    const txs = await raw(
      'SELECT description, notes, text_enc FROM transactions WHERE profile_id = ? ORDER BY id',
      P
    );
    const bill = (await raw('SELECT name FROM bills WHERE id = ?', id))[0]!;
    expect(txs).toHaveLength(2);
    expect(txs.every((t) => t.text_enc === 1 && isSealed(t.description))).toBe(true);
    // Never the bill's ciphertext copied across tables.
    expect(txs[0]!.description).not.toBe(bill.name);
    expect(txs[1]!.notes).toBe('');

    const openedTx = await opened(
      'transactions',
      'SELECT description, notes, beneficiary, payor, amount, text_enc FROM transactions WHERE profile_id = ? ORDER BY id',
      P
    );
    expect(openedTx).toEqual([
      {
        description: 'Electric',
        notes: 'meter 4',
        beneficiary: '',
        payor: '',
        amount: 70,
        text_enc: 1,
      },
      {
        description: 'Plain Water',
        notes: '',
        beneficiary: '',
        payor: '',
        amount: 15,
        text_enc: 1,
      },
    ]);
  });
});

describe('recurring rules with encryption on', () => {
  it('seals on create, opens on every read, and populates a freshly sealed transaction', async () => {
    const { id } = await json<{ id: number }>(
      call('POST', '/api/recurring', {
        description: 'Netflix',
        amount: 12,
        type: 'expense',
        frequency: 'monthly',
        next_date: day(0),
        notes: 'family plan',
      })
    );
    const plainId = await seed(
      'recurring_transactions',
      {
        profile_id: P,
        description: 'Plain Gym',
        amount: 30,
        type: 'expense',
        frequency: 'monthly',
        next_date: day(0),
        notes: 'old notes',
      },
      false
    );

    const stored = (
      await raw('SELECT description, notes, text_enc FROM recurring_transactions WHERE id = ?', id)
    )[0]!;
    expect(stored.text_enc).toBe(1);
    expect(isSealed(stored.description)).toBe(true);
    expect(isSealed(stored.notes)).toBe(true);

    const list = await json<Row[]>(call('GET', '/api/recurring'));
    expect(list.map((r) => [r.description, r.notes]).sort()).toEqual([
      ['Netflix', 'family plan'],
      ['Plain Gym', 'old notes'],
    ]);
    expect(await json<Row>(call('GET', `/api/recurring/${id}`))).toMatchObject({
      description: 'Netflix',
      notes: 'family plan',
    });
    const upcoming = await json<{ transactions: Row[]; byCategory: Array<{ items: Row[] }> }>(
      call('GET', '/api/recurring/upcoming')
    );
    expect(new Set(upcoming.transactions.map((t) => t.description))).toEqual(
      new Set(['Netflix', 'Plain Gym'])
    );

    // A PUT that sends no text leaves the stored ciphertext exactly as it was.
    await json(call('PUT', `/api/recurring/${id}`, { amount: 13 }));
    const afterAmount = (
      await raw('SELECT description, notes, amount FROM recurring_transactions WHERE id = ?', id)
    )[0]!;
    expect(afterAmount).toEqual({
      description: stored.description,
      notes: stored.notes,
      amount: 13,
    });

    await json(call('PUT', `/api/recurring/${id}`, { description: 'Netflix 4K' }));
    expect(
      await opened(
        'recurring_transactions',
        'SELECT description, notes, text_enc FROM recurring_transactions WHERE id = ?',
        id
      )
    ).toEqual([{ description: 'Netflix 4K', notes: 'family plan', text_enc: 1 }]);

    // Plaintext rule: an edit keeps it plaintext.
    await json(
      call('PUT', `/api/recurring/${plainId}`, { description: 'Plain Gym renamed', notes: null })
    );
    expect(
      (
        await raw(
          'SELECT description, notes, text_enc FROM recurring_transactions WHERE id = ?',
          plainId
        )
      )[0]
    ).toEqual({ description: 'Plain Gym renamed', notes: '', text_enc: 0 });

    for (const ruleId of [id, plainId]) {
      await json(call('POST', `/api/recurring/${ruleId}/populate`, {}));
    }
    const txs = await raw(
      'SELECT description, text_enc FROM transactions WHERE profile_id = ? ORDER BY id',
      P
    );
    expect(txs.every((t) => t.text_enc === 1 && isSealed(t.description))).toBe(true);
    expect(
      await opened(
        'transactions',
        'SELECT description, notes, beneficiary, payor, amount, text_enc FROM transactions WHERE profile_id = ? ORDER BY id',
        P
      )
    ).toEqual([
      {
        description: 'Netflix 4K',
        notes: 'family plan',
        beneficiary: '',
        payor: '',
        amount: 13,
        text_enc: 1,
      },
      {
        description: 'Plain Gym renamed',
        notes: '',
        beneficiary: '',
        payor: '',
        amount: 30,
        text_enc: 1,
      },
    ]);
  });

  it('keeps the NULL-notes-to-empty coercion of a PUT that does not send notes', async () => {
    const plainId = await seed(
      'recurring_transactions',
      {
        profile_id: P,
        description: 'Null notes',
        amount: 5,
        type: 'expense',
        frequency: 'monthly',
        notes: null,
      },
      false
    );
    await json(call('PUT', `/api/recurring/${plainId}`, { amount: 6 }));
    expect(
      (
        await raw(
          'SELECT notes, amount, text_enc FROM recurring_transactions WHERE id = ?',
          plainId
        )
      )[0]
    ).toEqual({ notes: '', amount: 6, text_enc: 0 });
  });
});

describe('bills reminder email with encryption on', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function seedDueBills() {
    await seed(
      'bills',
      { profile_id: P, name: 'Sealed Water Bill', amount: 40, type: 'bill', due_date: day(2) },
      true
    );
    await seed(
      'bills',
      { profile_id: P, name: 'Plain Phone Bill', amount: 25, type: 'bill', due_date: day(-3) },
      false
    );
    // Outside the window, and a subscription: neither is mailed.
    await seed(
      'bills',
      { profile_id: P, name: 'Far Future Bill', amount: 1, type: 'bill', due_date: day(30) },
      true
    );
    await seed(
      'bills',
      {
        profile_id: P,
        name: 'Some Subscription',
        amount: 9,
        type: 'subscription',
        due_date: day(1),
      },
      true
    );
  }

  function expectNames(part: string) {
    expect(part).toContain('Sealed Water Bill');
    expect(part).toContain('Plain Phone Bill');
    expect(part).not.toContain('Far Future Bill');
    expect(part).not.toContain('Some Subscription');
    expect(part).not.toContain(TEXT_PREFIX);
  }

  it('the preview carries plaintext names in both the html and the text part', async () => {
    await seedDueBills();
    const mail = await composeReminderPreview(KEYED, U, 'bills');
    expect(mail).not.toBeNull();
    expectNames(mail!.html);
    expectNames(mail!.text);
    // Overdue first: the plaintext bill due three days ago leads.
    expect(mail!.text.indexOf('Plain Phone Bill')).toBeLessThan(
      mail!.text.indexOf('Sealed Water Bill')
    );
  });

  it('the cron send mails plaintext names in both parts', async () => {
    await seedDueBills();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO settings (key, value, profile_id) VALUES ('email_notifications', 'true', ?)"
      ).bind(P),
      env.DB.prepare(
        "INSERT INTO settings (key, value, profile_id) VALUES ('email_bills_reminders', 'true', ?)"
      ).bind(P),
    ]);
    const sent: Array<{ to: string; html: string; text: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).includes('api.resend.com')) {
        sent.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    await runScheduledReminders('0 8 * * *', { ...KEYED, RESEND_API_KEY: 'rk_test' });
    const mine = sent.filter(
      (m) => m.to === EMAIL || (Array.isArray(m.to) && m.to.includes(EMAIL))
    );
    expect(mine).toHaveLength(1);
    expectNames(mine[0]!.html);
    expectNames(mine[0]!.text);
  });

  it('fails closed: without the key it throws instead of mailing ciphertext', async () => {
    await seedDueBills();
    await expect(composeReminderPreview(KEYLESS, U, 'bills')).rejects.toBeInstanceOf(
      DataKeyUnavailableError
    );
  });
});
