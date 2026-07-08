const { BaseRepository } = require('./baseRepo');

class RecurringRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT * FROM recurring_transactions WHERE profile_id = ? ORDER BY next_date ASC',
      profileId
    );
  }

  getById(id, profileId) {
    return this.get(
      'SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?',
      id,
      profileId
    );
  }

  getUpcoming(profileId) {
    return this.all(
      `SELECT * FROM recurring_transactions
       WHERE profile_id = ? AND active = 1 AND next_date IS NOT NULL
       ORDER BY next_date ASC LIMIT 10`,
      profileId
    );
  }

  create(data) {
    return this.insert('recurring_transactions', data);
  }

  update(id, profileId, data) {
    return super.update('recurring_transactions', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('recurring_transactions', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteAll(profileId) {
    return super.delete('recurring_transactions', 'profile_id = ?', profileId);
  }

  populate(id, profileId) {
    const r = this.getById(id, profileId);
    if (!r) return null;
    const date = r.next_date || new Date().toISOString().split('T')[0];
    // Wrap in a transaction so the INSERT, balance UPDATE, and next_date advance
    // are atomic. Matches the D1 batch semantics of the worker.
    return this.transaction(() => {
      const result = this.run(
        `INSERT INTO transactions (profile_id, description, amount, type, category_id, account_id, transfer_account_id, date, notes, beneficiary, payor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        profileId,
        r.description,
        r.amount,
        r.type,
        r.category_id,
        r.account_id ?? null,
        r.transfer_account_id ?? null,
        date,
        r.notes || '',
        '',
        ''
      );
      // Adjust account balances, mirroring the serverless computeBalanceDeltas:
      //   - transfer with From (account_id) + To (transfer_account_id): debit From, credit To;
      //   - income/expense with an account: move that one account;
      //   - a transfer missing a leg makes NO change (money can't vanish);
      //   - an account-less recurring is a pure reminder (no balance change).
      const bal = (delta, accId) =>
        this.run(
          'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id = ?',
          delta,
          accId,
          profileId
        );
      if (r.account_id != null) {
        if (r.type === 'transfer' && r.transfer_account_id != null) {
          bal(-r.amount, r.account_id);
          bal(r.amount, r.transfer_account_id);
        } else if (r.type === 'income' || r.type === 'expense') {
          bal(r.type === 'income' ? r.amount : -r.amount, r.account_id);
        }
      } else if (r.transfer_account_id != null && (r.type === 'income' || r.type === 'transfer')) {
        bal(r.amount, r.transfer_account_id);
      }
      // Advance next_date past the populated period — every frequency must move
      // forward or the route's idempotency guard (next_date > today) never trips
      // and the rule can be re-populated repeatedly, debiting the account each time.
      const next = new Date(date);
      if (r.frequency === 'daily') next.setDate(next.getDate() + 1);
      else if (r.frequency === 'weekly') next.setDate(next.getDate() + 7);
      else if (r.frequency === 'biweekly') next.setDate(next.getDate() + 14);
      else if (r.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
      else next.setMonth(next.getMonth() + 1); // monthly + safe default: always advance.
      this.run(
        'UPDATE recurring_transactions SET next_date = ? WHERE id = ? AND profile_id = ?',
        next.toISOString().split('T')[0],
        id,
        profileId
      );
      const nextDate = next.toISOString().split('T')[0];
      return { ...r, transactionId: result.lastInsertRowid, next_date: nextDate };
    });
  }
}

module.exports = { RecurringRepository };
