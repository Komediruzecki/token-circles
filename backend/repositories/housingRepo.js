const { BaseRepository } = require('./baseRepo');

class HousingRepository extends BaseRepository {
  list(profileId) {
    return this.all('SELECT * FROM housings WHERE profile_id = ? ORDER BY created_at DESC', profileId);
  }

  getById(id, profileId) {
    return this.get('SELECT * FROM housings WHERE id = ? AND profile_id = ?', id, profileId);
  }

  create(data) {
    return this.insert('housings', data);
  }

  update(id, profileId, data) {
    return super.update('housings', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('housings', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteAll(profileId) {
    return super.delete('housings', 'profile_id = ?', profileId);
  }
}

module.exports = { HousingRepository };
