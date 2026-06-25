const { BaseRepository } = require('./baseRepo');

class RetirementGoalsRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT * FROM retirement_goals WHERE profile_id = ? ORDER BY created_at DESC',
      profileId
    );
  }

  getById(id, profileId) {
    return this.get(
      'SELECT * FROM retirement_goals WHERE id = ? AND profile_id = ?',
      id,
      profileId
    );
  }

  create(data) {
    return this.insert('retirement_goals', data);
  }

  update(id, profileId, data) {
    return super.update('retirement_goals', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('retirement_goals', 'id = ? AND profile_id = ?', id, profileId);
  }
}

module.exports = { RetirementGoalsRepository };
