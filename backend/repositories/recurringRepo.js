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
    const result = this.run(
      `INSERT INTO transactions (profile_id, description, amount, type, category_id, date, notes, beneficiary, payor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      profileId, r.description, r.amount, r.type, r.category_id, date, r.notes || '', '', ''
    );
    return { ...r, transactionId: result.lastInsertRowid };
  }
}

module.exports = { RecurringRepository };
