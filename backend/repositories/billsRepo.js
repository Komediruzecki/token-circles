const { BaseRepository } = require('./baseRepo');

class BillsRepository extends BaseRepository {
  list(profileId) {
    return this.all('SELECT * FROM bills WHERE profile_id = ? ORDER BY due_date ASC', profileId);
  }

  getById(id, profileId) {
    return this.get('SELECT * FROM bills WHERE id = ? AND profile_id = ?', id, profileId);
  }

  getUpcoming(profileId, days = 7) {
    return this.all(
      `SELECT * FROM bills
       WHERE profile_id = ? AND due_date IS NOT NULL AND due_date >= date('now')
       AND due_date <= date('now', '+' || ? || ' days')
       ORDER BY due_date ASC`,
      profileId,
      String(days)
    );
  }

  getSummary(profileId) {
    const bills = this.all('SELECT * FROM bills WHERE profile_id = ?', profileId);
    const totalAmount = bills.reduce((s, b) => s + (b.amount || 0), 0);
    return { totalAmount, activeCount: bills.length, bills };
  }

  create(data) {
    return this.insert('bills', data);
  }

  update(id, profileId, data) {
    return super.update('bills', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('bills', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteAll(profileId) {
    return super.delete('bills', 'profile_id = ?', profileId);
  }

  markPaid(id, profileId) {
    const today = new Date().toISOString().split('T')[0];
    return super.update('bills', { last_paid_date: today }, 'id = ? AND profile_id = ?', id, profileId);
  }
}

module.exports = { BillsRepository };
