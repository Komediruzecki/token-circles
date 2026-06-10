const { BaseRepository } = require('./baseRepo');

class PortfolioRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT * FROM portfolio_holdings WHERE profile_id = ? ORDER BY purchase_date DESC',
      profileId
    );
  }

  getById(id, profileId) {
    return this.get(
      'SELECT * FROM portfolio_holdings WHERE id = ? AND profile_id = ?',
      id,
      profileId
    );
  }

  create(data) {
    return this.insert('portfolio_holdings', data);
  }

  update(id, profileId, data) {
    return super.update('portfolio_holdings', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('portfolio_holdings', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteAll(profileId) {
    return super.delete('portfolio_holdings', 'profile_id = ?', profileId);
  }
}

module.exports = { PortfolioRepository };
