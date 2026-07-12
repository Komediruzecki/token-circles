// Shared account-balance recompute/repair routine (audit A1/D3).
//
// For each given account, sets balance = starting_balance + the sum of that account's
// base-currency balance deltas across ALL of the profile's transactions, using the same
// convention as the create/update/delete paths in routes/transactions.ts and the client's
// computeBalanceDeltas (frontend/src/core/storage/idb.ts):
//   - expense/transfer debit account_id;
//   - income credits account_id;
//   - transfer credits transfer_account_id (the destination leg);
//   - income with NO account_id credits transfer_account_id.
// Money math is base currency (amount_local first, falling back to amount).
//
// This is the single source of truth reused by POST /api/import/execute and
// POST /api/accounts/recompute-balances so the two never diverge.
import * as db from './db';

export async function recomputeBalancesForAccounts(
  DB: D1Database,
  accountIds: number[]
): Promise<void> {
  const ids = [...new Set(accountIds)];
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  const [starts, out, inDirect, inTransfer] = await Promise.all([
    db.all<{ id: number; starting_balance: number | null }>(
      DB,
      `SELECT id, starting_balance FROM accounts WHERE id IN (${ph})`,
      ...ids
    ),
    db.all<{ account_id: number; total: number }>(
      DB,
      `SELECT account_id, COALESCE(SUM(COALESCE(amount_local, amount)),0) AS total FROM transactions WHERE account_id IN (${ph}) AND type IN ('expense','transfer') GROUP BY account_id`,
      ...ids
    ),
    db.all<{ account_id: number; total: number }>(
      DB,
      `SELECT account_id, COALESCE(SUM(COALESCE(amount_local, amount)),0) AS total FROM transactions WHERE account_id IN (${ph}) AND type = 'income' GROUP BY account_id`,
      ...ids
    ),
    // Credit transfer_account_id for transfers (the destination leg), and for income ONLY
    // when the row has no account_id. An income row with BOTH account_id and
    // transfer_account_id is already credited to account_id by the inDirect query above, so
    // crediting transfer_account_id here too would double-credit.
    db.all<{ transfer_account_id: number; total: number }>(
      DB,
      `SELECT transfer_account_id, COALESCE(SUM(COALESCE(amount_local, amount)),0) AS total FROM transactions WHERE transfer_account_id IN (${ph}) AND (type = 'transfer' OR (type = 'income' AND account_id IS NULL)) GROUP BY transfer_account_id`,
      ...ids
    ),
  ]);
  const startMap = new Map(starts.map((s) => [s.id, s.starting_balance || 0]));
  const outMap = new Map(out.map((r) => [r.account_id, r.total]));
  const inDirMap = new Map(inDirect.map((r) => [r.account_id, r.total]));
  const inTransMap = new Map(inTransfer.map((r) => [r.transfer_account_id, r.total]));
  const updates = ids.map((id) =>
    DB.prepare('UPDATE accounts SET balance = ? WHERE id = ?').bind(
      Math.round(
        ((startMap.get(id) || 0) -
          (outMap.get(id) || 0) +
          (inDirMap.get(id) || 0) +
          (inTransMap.get(id) || 0)) *
          100
      ) / 100,
      id
    )
  );
  if (updates.length) await DB.batch(updates);
}
