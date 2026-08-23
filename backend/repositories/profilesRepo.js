const { BaseRepository } = require('./baseRepo');
const { PROFILE_DATA_TABLES, PROFILE_CHILD_TABLES } = require('../lib/profileTables');

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

  /**
   * Delete every row of profile data, keeping the profile row itself.
   * `settings` is per-profile configuration rather than data, so it only goes when the
   * caller is deleting the profile outright (includeSettings).
   */
  clearDataForProfile(pid, { includeSettings = false } = {}) {
    const clear = this.db.transaction(() => {
      for (const child of PROFILE_CHILD_TABLES) {
        this.run(
          `DELETE FROM ${child.table} WHERE ${child.key} IN (SELECT id FROM ${child.parent} WHERE profile_id = ?)`,
          pid
        );
      }
      for (const table of PROFILE_DATA_TABLES) {
        this.run(`DELETE FROM ${table} WHERE profile_id = ?`, pid);
      }
      if (includeSettings) this.run('DELETE FROM settings WHERE profile_id = ?', pid);
    });
    clear();
  }

  deleteAllDataForProfile(pid) {
    const deleteAll = this.db.transaction(() => {
      this.clearDataForProfile(pid, { includeSettings: true });
      this.deleteById(pid);
    });
    deleteAll();
  }
}

module.exports = { ProfilesRepository };
