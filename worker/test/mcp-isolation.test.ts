/**
 * One table-driven sweep: user B's token must not see or touch user A's data through ANY tool.
 *
 * Written as a loop over the live registry rather than a fixed list, so a tool added later is
 * covered the day it is added instead of the day somebody remembers to extend this file.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { mintApiToken } from '../src/apitoken';
import { TOOLS } from '../src/mcp/registry';
// Importing the route module is what registers the tools into TOOLS.
import '../src/mcp';

const A_USER = 9700;
const A_PROFILE = 9701;
const B_USER = 9800;
const B_PROFILE = 9801;
let bToken = '';

/** Minimal valid arguments per tool, all pointed at user A's profile. */
const ARGS: Record<string, Record<string, unknown>> = {
  whoami: {},
  get_overview: {},
  list_transactions: {},
  summarize_spending: {},
  list_reference_data: {},
  get_budgets_and_goals: {},
  export_snapshot: {},
  prepare_import: { mode: 'preview' },
  list_imports: {},
  undo_import: { importId: 'a-batch' },
  create_transactions: {
    transactions: [{ date: '2026-04-01', description: 'x', amount: -1, type: 'expense' }],
  },
  create_account: { name: 'Intruder' },
  categorize_transactions: { transactionIds: [97001], categoryId: 97002 },
  upsert_tag_rule: { tagName: 't', name: 'r', criteria: {} },
  upsert_budget: { categoryId: 97002, amount: 10, startDate: '2026-04-01' },
};

async function callAsB(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await SELF.fetch('https://api.example.com/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: { ...args, profileId: A_PROFILE } },
    }),
  });
  return ((await res.json()) as any).result;
}

beforeAll(async () => {
  for (const [uid, pid, email] of [
    [A_USER, A_PROFILE, 'a@example.com'],
    [B_USER, B_PROFILE, 'b@example.com'],
  ] as const) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1)"
    )
      .bind(uid, email)
      .run();
    await env.DB.prepare("INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'P', ?)")
      .bind(pid, uid)
      .run();
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO categories (id, name, type, profile_id) VALUES (97002, 'A Category', 'expense', ?)"
  )
    .bind(A_PROFILE)
    .run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO transactions (id, date, description, amount, type, currency, profile_id, import_id) VALUES (97001, '2026-04-01', 'A secret', -99, 'expense', 'EUR', ?, 'a-batch')"
  )
    .bind(A_PROFILE)
    .run();

  bToken = (
    await mintApiToken(env.DB, B_USER, {
      name: 'b',
      scopes: ['read', 'write', 'import'],
      defaultProfileId: B_PROFILE,
    })
  ).secret;
});

describe('cross-user isolation', () => {
  it('has minimal arguments defined for every registered tool', () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    const missing = TOOLS.map((t) => t.name).filter((n) => !(n in ARGS));
    expect(missing, `add these to ARGS: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(TOOLS.map((t) => t.name))(
    "%s refuses user A's profile when called with user B's token",
    async (name) => {
      const result = await callAsB(name, ARGS[name] ?? {});
      expect(result.isError, `${name} accepted a foreign profileId`).toBe(true);
      expect(result.content[0].text).toMatch(/profile/i);
    }
  );

  it("leaves user A's data completely untouched", async () => {
    const tx = await env.DB.prepare(
      'SELECT description, amount, category_id FROM transactions WHERE id = 97001'
    ).first<{ description: string; amount: number; category_id: number | null }>();
    expect(tx).toMatchObject({ description: 'A secret', amount: -99, category_id: null });

    const counts = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM accounts WHERE profile_id = ?) AS accounts, (SELECT COUNT(*) FROM budgets WHERE profile_id = ?) AS budgets, (SELECT COUNT(*) FROM tag_rules WHERE profile_id = ?) AS rules'
    )
      .bind(A_PROFILE, A_PROFILE, A_PROFILE)
      .first<{ accounts: number; budgets: number; rules: number }>();
    expect(counts).toEqual({ accounts: 0, budgets: 0, rules: 0 });
  });
});
