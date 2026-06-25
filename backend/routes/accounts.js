const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');
const { asyncHandler } = require('../lib/errors');

module.exports = function ({ apiRateLimiter, logError, requireAuth }) {
  const router = express.Router();

  router.get('/api/accounts', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const accounts = req.repos.accounts.list(pid);
    res.json(accounts);

  }));

  router.post('/api/accounts', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const { name, type, currency, balance, notes, starting_balance, starting_date } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const validTypes = ['giro', 'ib', 'savings', 'cash'];
    const accountType = validTypes.includes(type) ? type : 'giro';
    const startBalance =
      starting_balance !== undefined ? parseFloat(starting_balance) : parseFloat(balance) || 0;
    const startDate = starting_date || null;
    const result = req.repos.accounts.create({
      name: name.trim(),
      type: accountType,
      currency: currency || 'USD',
      balance: startBalance,
      notes: notes || '',
      profile_id: pid,
      starting_balance: startBalance,
      starting_date: startDate,
    });
    res.json({ id: result.lastInsertRowid, message: 'Account created' });

  }));

  router.get('/api/accounts/:id', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const account = req.repos.accounts.getById(req.params.id, pid);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json(account);

  }));

  router.put('/api/accounts/:id', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const body = req.body || {};
    const { name, type, currency, balance, notes, starting_balance, starting_date } = body;
    const existing = req.repos.accounts.getById(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    const validTypes = ['giro', 'ib', 'savings', 'cash'];
    const accountType = validTypes.includes(type) ? type : 'giro';

    const balanceVal = parseFloat(balance);
    const data = {
      name: typeof name === 'string' ? name.trim() : existing.name,
      type: accountType,
      currency: currency || 'USD',
      balance: isNaN(balanceVal) ? existing.balance : balanceVal,
      notes: notes || '',
    };
    if (starting_balance !== undefined) {
      const sb = parseFloat(starting_balance);
      data.starting_balance = isNaN(sb) ? 0 : sb;
    }
    if (starting_date !== undefined) data.starting_date = starting_date || null;

    req.repos.accounts.update(req.params.id, pid, data);
    res.json({ message: 'Account updated' });

  }));

  router.delete('/api/accounts/:id', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const existing = req.repos.accounts.getById(req.params.id, pid);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    req.repos.accounts.deleteById(req.params.id, pid);
    res.json({ message: 'Account deleted' });

  }));

  // ========================
  // ACCOUNT BALANCE HISTORY
  // ========================
  router.get('/api/accounts/:id/history', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const account = req.repos.accounts.getById(req.params.id, pid);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const history = req.repos.accounts.getBalanceHistory(req.params.id);
    res.json(history);

  }));

  router.post('/api/accounts/:id/history', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const account = req.repos.accounts.getById(req.params.id, pid);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const balance = parseFloat((req.body || {}).balance ?? account.balance);
    if (isNaN(balance)) return res.status(400).json({ error: 'Invalid balance value' });
    const recordedAt = new Date().toISOString();
    const id = req.repos.accounts.addBalanceEntry(req.params.id, balance, recordedAt);
    res.json({ id, balance, recorded_at: recordedAt });

  }));

  router.delete('/api/accounts/:id/history', apiRateLimiter, requireAuth, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const account = req.repos.accounts.getById(req.params.id, pid);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    req.repos.accounts.deleteBalanceHistory(req.params.id);
    res.json({ message: 'Balance history deleted' });

  }));

  // Get reconciliation summary for a specific account
  router.get('/api/accounts/:id/reconciliation-summary', apiRateLimiter, asyncHandler((req, res) => {
    const pid = getProfileId(req);
    const account = req.repos.accounts.get(
      'SELECT id, name FROM accounts WHERE id = ? AND profile_id = ?',
      req.params.id, pid
    );
    if (!account) return res.status(404).json({ error: 'Account not found' });

    // Get unreconciled transactions for this account
    // Note: accounts table doesn't directly link to transactions, so we show all profile transactions
    const unreconciled = req.repos.transactions.get(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE profile_id = ? AND (reconciled = 0 OR reconciled IS NULL)`,
      pid
    );
    const reconciled = req.repos.transactions.get(
      `SELECT COUNT(*) as count FROM transactions WHERE profile_id = ? AND reconciled = 1`,
      pid
    );

    res.json({
      account_id: account.id,
      account_name: account.name,
      unreconciled_count: unreconciled.count,
      unreconciled_total: unreconciled.total,
      reconciled_count: reconciled.count,
      total_transactions: unreconciled.count + reconciled.count,
    });

  }));

  // Net worth timeline from balance history
  router.get('/api/accounts/history/timeline', apiRateLimiter, asyncHandler((req, res) => {
    const pids = getProfileIds(req);
    const inClause = pids.map(() => '?').join(',');
    const rows = req.repos.accounts.all(
      `SELECT abh.recorded_at as date, SUM(abh.balance) as net_worth
       FROM account_balance_history abh
       JOIN accounts a ON abh.account_id = a.id
       WHERE a.profile_id IN (${inClause})
       GROUP BY date(abh.recorded_at)
       ORDER BY date ASC`,
      ...pids
    );
    res.json(rows);

  }));

  return router;
};
