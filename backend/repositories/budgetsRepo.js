const { BaseRepository } = require('./baseRepo');

class BudgetsRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT b.*, c.name as category_name, c.color as category_color FROM budgets b LEFT JOIN categories c ON b.category_id = c.id WHERE b.profile_id = ? ORDER BY c.name',
      profileId
    );
  }

  listByProfiles(profileIds) {
    const inClause = profileIds.map(() => '?').join(',');
    return this.all(
      `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
       FROM budgets b
       JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
       WHERE b.profile_id IN (${inClause})
       ORDER BY b.id DESC`,
      ...profileIds
    );
  }

  listActive(profileId, startDate) {
    return this.all(
      `SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
       FROM budgets b
       JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
       WHERE b.profile_id = ? AND (b.end_date IS NULL OR b.end_date >= ?)`,
      profileId,
      startDate
    );
  }

  getById(id, profileId) {
    return this.get('SELECT * FROM budgets WHERE id = ? AND profile_id = ?', id, profileId);
  }

  getByCategoryForMonth(categoryId, profileId, startDate, period) {
    return this.get(
      'SELECT * FROM budgets WHERE category_id = ? AND profile_id = ? AND start_date = ? AND period = ?',
      categoryId,
      profileId,
      startDate,
      period
    );
  }

  getByCategory(categoryId, profileId, period) {
    return this.get(
      'SELECT * FROM budgets WHERE category_id = ? AND profile_id = ? AND period = ?',
      categoryId,
      profileId,
      period
    );
  }

  create(data) {
    return this.insert('budgets', data);
  }

  update(id, profileId, data) {
    return super.update('budgets', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('budgets', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteAll(profileId) {
    return super.delete('budgets', 'profile_id = ?', profileId);
  }

  deleteByDateRange(profileId, startDate, endDate) {
    return this.run(
      'DELETE FROM budgets WHERE profile_id = ? AND start_date >= ? AND start_date < ?',
      profileId,
      startDate,
      endDate
    );
  }

  bulkCreateMonthly(profileId, startDate, entries) {
    const insert = this.db.prepare(
      'INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (?, ?, ?, ?, ?)'
    );
    const runAll = this.db.transaction(() => {
      for (const item of entries) {
        insert.run(item.category_id, item.total, 'monthly', startDate, profileId);
      }
    });
    runAll();
  }

  duplicateLast(profileId, year, month) {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevBudgets = this.all(
      'SELECT * FROM budgets WHERE profile_id = ? AND start_date LIKE ?',
      profileId,
      `${prevYear}-${String(prevMonth).padStart(2, '0')}%`
    );
    let count = 0;
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, ?, ?, ?)'
    );
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    for (const b of prevBudgets) {
      insert.run(profileId, b.category_id, b.amount, b.period, startDate);
      count++;
    }
    return count;
  }
}

module.exports = { BudgetsRepository };
