import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileIds } from '../profile';
import { normalizedTransactionAmountSql } from '../transaction-amount';
import * as db from '../db';

// Port of backend/routes/counterparties.js — aggregate beneficiaries (expense) and
// payors (income) into net counterparty totals.
export const counterpartiesRoutes = new Hono<AppEnv>();

counterpartiesRoutes.get('/api/counterparties', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const amountSql = normalizedTransactionAmountSql();

  const outgoing = await db.all<{ name: string; total: number; count: number }>(
    c.env.DB,
    `SELECT beneficiary AS name, SUM(${amountSql}) AS total, COUNT(*) AS count
     FROM transactions
     WHERE beneficiary != '' AND type = 'expense' AND profile_id IN (${inClause})
     GROUP BY beneficiary`,
    ...pids
  );
  const incoming = await db.all<{ name: string; total: number; count: number }>(
    c.env.DB,
    `SELECT payor AS name, SUM(${amountSql}) AS total, COUNT(*) AS count
     FROM transactions
     WHERE payor != '' AND type = 'income' AND profile_id IN (${inClause})
     GROUP BY payor`,
    ...pids
  );

  const map = new Map<
    string,
    { name: string; incoming: number; outgoing: number; count: number }
  >();
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
