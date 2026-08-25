/**
 * A transfer's SOURCE account comes from the Means of Payment column — and nothing ever created
 * an account from that column.
 *
 * `newAccts` (the preview's "accounts this run would create") is built by scanning the CATEGORY
 * column only, and `toCreate` is driven entirely by `categoryTypes`, a map the UI builds from the
 * category column's distinct values. Means-of-Payment values are enumerated nowhere, classified
 * nowhere, and offered nowhere — so on a profile that has no accounts yet, every transfer row
 * resolves `account_id` to null and is rejected with "A transfer must have both source and
 * destination accounts".
 *
 * Which is what a first import on a new account is: a sheet full of transfers, every one of them
 * refused, and a message that names neither the side that is missing nor the value that failed
 * to resolve.
 *
 * The backend was always ready for this — `validAccountNames` already includes Means-of-Payment
 * values, so it will create one when asked. Nothing ever asked.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';

beforeEach(async () => {
  for (const table of [
    'transactions',
    'account_balance_history',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (97, 'xfer@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (970, 97, 'Main')"),
  ]);
  cookie = (await issueSessionCookie(97, 'password', env)).split(';')[0];
});

function execute(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/import/execute', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': '970',
    },
    body: JSON.stringify(body),
  });
}

const MAPPING = {
  date: 'date',
  description: 'description',
  amount: 'amount',
  category: 'category',
  means_of_payment: 'means_of_payment',
  type: 'type',
};

/** One transfer out of Erste Current into Revolut, the shape the reported sheet has. */
const TRANSFER_ROW = {
  date: '22/07/2026',
  description: 'Top-up by *1111',
  amount: '150',
  type: 'transfer',
  means_of_payment: 'Erste Current',
  category: 'Revolut',
};

type ExecuteBody = {
  imported: number;
  accounts_created?: number;
  new_accounts?: string[];
  skipped_items: Array<{ index: number; reason: string; label?: string }>;
};

describe('a transfer whose accounts do not exist yet', () => {
  it('offers the Means-of-Payment value as an account to create, not just the category one', async () => {
    const res = await execute({ rows: [TRANSFER_ROW], mapping: MAPPING, dry_run: true });
    const body = (await res.json()) as ExecuteBody;
    expect(res.status).toBe(200);

    const offered = (body.new_accounts ?? []).map((n) => n.toLowerCase());
    // Both sides of a transfer name an account. The preview has to say so before the run, or
    // the first the user hears of it is a rejected row.
    expect(offered).toContain('revolut');
    expect(offered).toContain('erste current');
  });

  it('imports the transfer once both accounts are approved', async () => {
    const res = await execute({
      rows: [TRANSFER_ROW],
      mapping: MAPPING,
      categoryTypes: { Revolut: 'account', 'Erste Current': 'account' },
      dry_run: false,
    });
    const body = (await res.json()) as ExecuteBody;
    expect(res.status).toBe(200);
    expect(body.skipped_items ?? []).toEqual([]);
    expect(body.imported).toBe(1);
    expect(body.accounts_created).toBe(2);

    const tx = await env.DB.prepare(
      'SELECT type, account_id, transfer_account_id FROM transactions WHERE profile_id = 970'
    ).first<{ type: string; account_id: number | null; transfer_account_id: number | null }>();
    expect(tx?.type).toBe('transfer');
    expect(tx?.account_id).not.toBeNull();
    expect(tx?.transfer_account_id).not.toBeNull();
    expect(tx?.account_id).not.toBe(tx?.transfer_account_id);
  });

  it('does not reject a transfer in the PREVIEW whose accounts this run will create', async () => {
    // The preview is a dry run, so it inserts nothing -- but the real run creates the approved
    // accounts before it validates a single row. Answering from the pre-import state told a
    // first-time importer that every transfer in the sheet was broken (5183 rows, every
    // transfer among them) while the very same file imported cleanly the moment they pressed
    // the button. The preview has to describe what the import will produce.
    const res = await execute({
      rows: [TRANSFER_ROW],
      mapping: MAPPING,
      categoryTypes: { Revolut: 'account', 'Erste Current': 'account' },
      dry_run: true,
    });
    const body = (await res.json()) as ExecuteBody;
    expect(res.status).toBe(200);
    expect(body.skipped_items ?? []).toEqual([]);

    // ...and it must still be a dry run: nothing written, placeholder ids never persisted.
    const accounts = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM accounts WHERE profile_id = 970'
    ).first<{ n: number }>();
    const txs = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE profile_id = 970'
    ).first<{ n: number }>();
    expect(accounts?.n).toBe(0);
    expect(txs?.n).toBe(0);
  });

  it('says which side is missing and which value did not resolve', async () => {
    // Nothing approved: the row still cannot import, but the rejection has to be actionable.
    // "A transfer must have both source and destination accounts" names neither the side nor
    // the cell, which is what made 341 identical lines impossible to act on.
    const res = await execute({ rows: [TRANSFER_ROW], mapping: MAPPING, dry_run: true });
    const body = (await res.json()) as ExecuteBody;
    const reason = body.skipped_items?.[0]?.reason ?? '';

    expect(reason).toContain('Erste Current');
    expect(reason).toContain('Revolut');
    expect(reason.toLowerCase()).toMatch(/means of payment|source/);
  });
});
