import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileIds } from '../profile';
import { normalizedTransactionAmountSql } from '../transaction-amount';
import { keyringFor } from '../data-keys';
import { compareBinary, openRows, SqlSum } from '../sealed-rows';
import * as db from '../db';

// Port of backend/routes/counterparties.js — aggregate beneficiaries (expense) and
// payors (income) into net counterparty totals.
export const counterpartiesRoutes = new Hono<AppEnv>();

type Counterparty = { name: string; incoming: number; outgoing: number; count: number };
type GroupRow = { name: string | null; total: number | null; count: number };

counterpartiesRoutes.get('/api/counterparties', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const amountSql = normalizedTransactionAmountSql();
  const ring = keyringFor(c);

  const map = new Map<string, Counterparty>();
  let outgoing: GroupRow[];
  let incoming: GroupRow[];

  if (ring.enabled) {
    // beneficiary and payor may be ciphertext, which SQL can neither compare nor group. So fetch
    // one row per transaction and open only the one column each query needs, then rebuild exactly
    // what GROUP BY returned: one row per exact name, in BINARY name order, SUM skipping NULL
    // amounts, COUNT(*) every row. The merge below then sees the same rows in the same order as
    // with no key, ties and all. `!= ''` alone stays in SQL: '' and NULL are never sealed, so it
    // means the same on either form and keeps empty names out of the scan.
    const userId = c.get('userId');
    const groups = async (
      column: 'beneficiary' | 'payor',
      type: 'expense' | 'income'
    ): Promise<GroupRow[]> => {
      const rows = await openRows(
        ring,
        userId,
        'transactions',
        await db.all<Record<string, unknown>>(
          c.env.DB,
          `SELECT ${column}, text_enc, ${amountSql} AS amt
           FROM transactions
           WHERE ${column} != '' AND type = '${type}' AND profile_id IN (${inClause})`,
          ...pids
        )
      );
      const byName = new Map<string, { sum: SqlSum; count: number }>();
      for (const row of rows) {
        const name = row[column];
        if (name == null || name === '') continue; // `!= ''` drops '' and NULL alike
        let g = byName.get(String(name));
        if (!g) byName.set(String(name), (g = { sum: new SqlSum(), count: 0 }));
        g.sum.add(row.amt);
        g.count++;
      }
      return [...byName.keys()].sort(compareBinary).map((name) => {
        const g = byName.get(name)!;
        return { name, total: g.sum.sum, count: g.count };
      });
    };
    [outgoing, incoming] = await Promise.all([
      groups('beneficiary', 'expense'),
      groups('payor', 'income'),
    ]);
  } else {
    // No master key: every row is plaintext, so SQL groups exactly as it always has.
    outgoing = await db.all<{ name: string; total: number; count: number }>(
      c.env.DB,
      `SELECT beneficiary AS name, SUM(${amountSql}) AS total, COUNT(*) AS count
       FROM transactions
       WHERE beneficiary != '' AND type = 'expense' AND profile_id IN (${inClause})
       GROUP BY beneficiary`,
      ...pids
    );
    incoming = await db.all<{ name: string; total: number; count: number }>(
      c.env.DB,
      `SELECT payor AS name, SUM(${amountSql}) AS total, COUNT(*) AS count
       FROM transactions
       WHERE payor != '' AND type = 'income' AND profile_id IN (${inClause})
       GROUP BY payor`,
      ...pids
    );
  }

  for (const row of outgoing) {
    const name = (row.name || '').trim();
    if (!name) continue;
    map.set(name, { name, incoming: 0, outgoing: row.total || 0, count: row.count || 0 });
  }
  for (const row of incoming) {
    const name = (row.name || '').trim();
    if (!name) continue;
    const ex = map.get(name);
    if (ex) {
      ex.incoming = row.total || 0;
      ex.count += row.count || 0;
    } else {
      map.set(name, { name, incoming: row.total || 0, outgoing: 0, count: row.count || 0 });
    }
  }

  const result = Array.from(map.values()).map((x) => ({
    name: x.name,
    incoming: Math.round(x.incoming * 100) / 100,
    outgoing: Math.round(x.outgoing * 100) / 100,
    net: Math.round((x.incoming - x.outgoing) * 100) / 100,
    transaction_count: x.count,
  }));
  result.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return c.json(result);
});
