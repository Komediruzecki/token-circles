const { BaseRepository } = require('./baseRepo')

class BudgetsRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT b.*, c.name as category_name, c.color as category_color FROM budgets b LEFT JOIN categories c ON b.category_id = c.id WHERE b.profile_id = ? ORDER BY c.name',
      profileId
    )
  }

  getById(id, profileId) {
    return this.get('SELECT * FROM budgets WHERE id = ? AND profile_id = ?', id, profileId)
  }

  getByCategory(categoryId, profileId, period) {
    return this.get(
      'SELECT * FROM budgets WHERE category_id = ? AND profile_id = ? AND period = ?',
      categoryId, profileId, period
    )
  }

  create(data) {
    return this.insert('budgets', data)
  }

  update(id, profileId, data) {
    return this.update('budgets', data, 'id = ? AND profile_id = ?', id, profileId)
  }

  deleteById(id, profileId) {
    return this.delete('budgets', 'id = ? AND profile_id = ?', id, profileId)
  }

  deleteAll(profileId) {
    return this.delete('budgets', 'profile_id = ?', profileId)
  }

  duplicateLast(profileId, year, month) {
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const prevBudgets = this.all(
      "SELECT * FROM budgets WHERE profile_id = ? AND start_date LIKE ?",
      profileId, `${prevYear}-${String(prevMonth).padStart(2, '0')}%`
    )
    let count = 0
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, ?, ?, ?)'
    )
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    for (const b of prevBudgets) {
      insert.run(profileId, b.category_id, b.amount, b.period, startDate)
      count++
    }
    return count
  }
}

module.exports = { BudgetsRepository }
