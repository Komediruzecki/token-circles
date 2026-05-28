const { BaseRepository } = require('./baseRepo');

class ProfilesRepository extends BaseRepository {
  listAll() {
    return super.all('SELECT * FROM profiles ORDER BY id');
  }

  allByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return super.all(`SELECT * FROM profiles WHERE id IN (${placeholders}) ORDER BY id`, ...ids);
  }

  getById(id) {
    return this.get('SELECT * FROM profiles WHERE id = ?', id);
  }

  getByName(name) {
    return this.get('SELECT id FROM profiles WHERE LOWER(name) = LOWER(?)', name);
  }

  create(name, userId) {
    return this.insert('profiles', { name, user_id: userId });
  }

  updateName(id, name) {
    this.run('UPDATE profiles SET name = ? WHERE id = ?', name.trim(), id);
    return this.getById(id);
  }

  deleteById(id) {
    return this.run('DELETE FROM profiles WHERE id = ?', id);
  }

  profileCount() {
    return super.count('profiles');
  }

  hasSeededProfiles(ids) {
    const rows = this.allByIds(ids);
    return rows.length > 0;
  }

  listByUserId(userId) {
    return super.all('SELECT * FROM profiles WHERE user_id = ? ORDER BY id', userId);
  }

  deleteAllDataForProfile(pid) {
    const tables = [
      'transactions',
      'budgets',
      'categories',
      'loans',
      'accounts',
      'goals',
      'account_balance_history',
      'receipts',
      'portfolio_holdings',
      'bills',
      'settings',
    ];
    const deleteAll = this.db.transaction(() => {
      for (const table of tables) {
        this.run(`DELETE FROM ${table} WHERE profile_id = ?`, pid);
      }
      this.deleteById(pid);
    });
    deleteAll();
  }
}

module.exports = { ProfilesRepository };
