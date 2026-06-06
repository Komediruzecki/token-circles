const { BaseRepository } = require('./baseRepo');

class TransactionsRepository extends BaseRepository {
  list(profileId, filters = {}) {
    let sql =
      'SELECT t.*, c.name as category_name, c.color as category_color FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.profile_id = ?';
    const params = [profileId];

    if (filters.type) {
      sql += ' AND t.type = ?';
      params.push(filters.type);
    }
    if (filters.startDate) {
      sql += ' AND t.date >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ' AND t.date <= ?';
      params.push(filters.endDate);
    }
    if (filters.search) {
      sql +=
        ' AND (t.description LIKE ? OR t.notes LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ?)';
      const q = `%${filters.search}%`;
      params.push(q, q, q, q);
    }
    if (filters.category_id) {
      sql += ' AND t.category_id = ?';
      params.push(filters.category_id);
    }
    if (filters.account_id) {
      sql += ' AND (t.account_id = ? OR t.transfer_account_id = ?)';
      params.push(filters.account_id, filters.account_id);
    }

    sql += ' ORDER BY t.date DESC, t.id DESC';
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }
    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    return this.all(sql, ...params);
  }

  getById(id, profileId) {
    return this.get(
      'SELECT t.*, c.name as category_name, c.color as category_color FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id = ? AND t.profile_id = ?',
      id,
      profileId
    );
  }

  create(data) {
    return this.insert('transactions', data);
  }

  update(id, profileId, data) {
    return super.update('transactions', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('transactions', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteAll(profileId) {
    return super.delete('transactions', 'profile_id = ?', profileId);
  }

  deleteAllForProfile(profileId) {
    return this.deleteAll(profileId);
  }

  summary(profileId) {
    const income = this.get(
      "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE profile_id = ? AND type = 'income'",
      profileId
    );
    const expense = this.get(
      "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE profile_id = ? AND type = 'expense'",
      profileId
    );
    return {
      totalIncome: income.total,
      totalExpenses: expense.total,
      count: this.count('transactions', 'profile_id = ?', profileId),
    };
  }

  countByProfile(profileId) {
    return this.count('transactions', 'profile_id = ?', profileId);
  }

  getDistinctYears(profileId) {
    const rows = this.all(
      'SELECT DISTINCT substr(date, 1, 4) as year FROM transactions WHERE profile_id = ? ORDER BY year DESC',
      profileId
    );
    return rows.map((r) => r.year);
  }

  getOldTxForBalance(id) {
    return this.get(
      'SELECT account_id, transfer_account_id, type, amount FROM transactions WHERE id = ?',
      id
    );
  }
}

module.exports = { TransactionsRepository };
