const express = require('express');
const { getProfileId, getProfileIds } = require('../middleware/profile');

module.exports = function ({ db, apiRateLimiter, logError, requireAuth }) {
  const router = express.Router();

  router.get('/api/accounts', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const accounts = req.repos.accounts.list(pid);
      res.json(accounts);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/accounts', apiRateLimiter, requireAuth, (req, res) => {
    try {
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
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/accounts/:id', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const account = req.repos.accounts.getById(req.params.id, pid);
      if (!account) return res.status(404).json({ error: 'Account not found' });
      res.json(account);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/accounts/:id', apiRateLimiter, requireAuth, (req, res) => {
    try {
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
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/accounts/:id', apiRateLimiter, requireAuth, (req, res) => {
    try {
      const pid = getProfileId(req);
      const existing = req.repos.accounts.getById(req.params.id, pid);
      if (!existing) return res.status(404).json({ error: 'Account not found' });
      req.repos.accounts.deleteById(req.params.id, pid);
      res.json({ message: 'Account deleted' });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ========================
  // ACCOUNT BALANCE HISTORY
  // ========================
  router.get('/api/accounts/:id/history', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const account = req.repos.accounts.getById(req.params.id, pid);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      const history = req.repos.accounts.getBalanceHistory(req.params.id);
      res.json(history);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/accounts/:id/history', apiRateLimiter, requireAuth, (req, res) => {
    try {
      const pid = getProfileId(req);
      const account = req.repos.accounts.getById(req.params.id, pid);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      const balance = parseFloat((req.body || {}).balance ?? account.balance);
      if (isNaN(balance)) return res.status(400).json({ error: 'Invalid balance value' });
      const recordedAt = new Date().toISOString();
      const id = req.repos.accounts.addBalanceEntry(req.params.id, balance, recordedAt);
      res.json({ id, balance, recorded_at: recordedAt });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/api/accounts/:id/history', apiRateLimiter, requireAuth, (req, res) => {
    try {
      const pid = getProfileId(req);
      const account = req.repos.accounts.getById(req.params.id, pid);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      req.repos.accounts.deleteBalanceHistory(req.params.id);
      res.json({ message: 'Balance history deleted' });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get reconciliation summary for a specific account
  router.get('/api/accounts/:id/reconciliation-summary', apiRateLimiter, (req, res) => {
    try {
      const pid = getProfileId(req);
      const account = db
        .prepare('SELECT id, name FROM accounts WHERE id = ? AND profile_id = ?')
        .get(req.params.id, pid);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      // Get unreconciled transactions for this account
      // Note: accounts table doesn't directly link to transactions, so we show all profile transactions
      const unreconciled = db
        .prepare(
          `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
           FROM transactions
           WHERE profile_id = ? AND (reconciled = 0 OR reconciled IS NULL)`
        )
        .get(pid);
      const reconciled = db
        .prepare(
          `SELECT COUNT(*) as count FROM transactions WHERE profile_id = ? AND reconciled = 1`
        )
        .get(pid);

      res.json({
        account_id: account.id,
        account_name: account.name,
        unreconciled_count: unreconciled.count,
        unreconciled_total: unreconciled.total,
        reconciled_count: reconciled.count,
        total_transactions: unreconciled.count + reconciled.count,
      });
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Net worth timeline from balance history
  router.get('/api/accounts/history/timeline', apiRateLimiter, (req, res) => {
    try {
      const pids = getProfileIds(req);
      const inClause = pids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT abh.recorded_at as date, SUM(abh.balance) as net_worth
           FROM account_balance_history abh
           JOIN accounts a ON abh.account_id = a.id
           WHERE a.profile_id IN (${inClause})
           GROUP BY date(abh.recorded_at)
           ORDER BY date ASC`
        )
        .all(...pids);
      res.json(rows);
    } catch (err) {
      console.error(err.message);
      logError('error', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
