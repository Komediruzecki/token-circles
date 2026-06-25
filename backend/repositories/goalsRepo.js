const { BaseRepository } = require('./baseRepo');

class GoalsRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT * FROM savings_goals WHERE profile_id = ? ORDER BY created_at DESC',
      profileId
    );
  }

  listByProfiles(profileIds) {
    const inClause = profileIds.map(() => '?').join(',');
    return this.all(
      `SELECT * FROM savings_goals WHERE profile_id IN (${inClause}) ORDER BY created_at DESC`,
      ...profileIds
    );
  }

  getById(id, profileId) {
    return this.get('SELECT * FROM savings_goals WHERE id = ? AND profile_id = ?', id, profileId);
  }

  create(data) {
    return this.insert('savings_goals', data);
  }

  update(id, profileId, data) {
    return super.update('savings_goals', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('savings_goals', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteAll(profileId) {
    return super.delete('savings_goals', 'profile_id = ?', profileId);
  }

  updateAmount(id, profileId, amount) {
    return this.run(
      'UPDATE savings_goals SET current_amount = ? WHERE id = ? AND profile_id = ?',
      amount,
      id,
      profileId
    );
  }
}

module.exports = { GoalsRepository };
