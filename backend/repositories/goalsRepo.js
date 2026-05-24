const { BaseRepository } = require('./baseRepo')

class GoalsRepository extends BaseRepository {
  list(profileId) {
    return this.all('SELECT * FROM goals WHERE profile_id = ? ORDER BY created_at DESC', profileId)
  }

  getById(id, profileId) {
    return this.get('SELECT * FROM goals WHERE id = ? AND profile_id = ?', id, profileId)
  }

  create(data) {
    return this.insert('goals', data)
  }

  update(id, profileId, data) {
    return this.update('goals', data, 'id = ? AND profile_id = ?', id, profileId)
  }

  deleteById(id, profileId) {
    return this.delete('goals', 'id = ? AND profile_id = ?', id, profileId)
  }

  deleteAll(profileId) {
    return this.delete('goals', 'profile_id = ?', profileId)
  }
}

module.exports = { GoalsRepository }
