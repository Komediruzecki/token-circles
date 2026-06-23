const { BaseRepository } = require('./baseRepo');

class SettingsRepository extends BaseRepository {
  getValue(key) {
    return this.all('SELECT value FROM settings WHERE key = ?', key);
  }

  get(key) {
    return this.get('SELECT value FROM settings WHERE key = ?', key);
  }

  upsert(key, value, profileId) {
    return this.run(
      'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)',
      key,
      value,
      profileId
    );
  }

  listByPrefix(profileId, prefix) {
    return this.all(
      'SELECT key, value FROM settings WHERE profile_id = ? AND key LIKE ?',
      profileId,
      prefix + '%'
    );
  }
}

module.exports = { SettingsRepository };
