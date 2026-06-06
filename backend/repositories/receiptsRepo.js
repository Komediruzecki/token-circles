const { BaseRepository } = require('./baseRepo');

class ReceiptsRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT * FROM receipts WHERE profile_id = ? ORDER BY id DESC',
      profileId
    );
  }

  getById(id) {
    return this.get('SELECT * FROM receipts WHERE id = ?', id);
  }

  getByIdAndProfile(id, profileId) {
    return this.get('SELECT * FROM receipts WHERE id = ? AND profile_id = ?', id, profileId);
  }

  getByTransactionId(transactionId, profileId) {
    return this.get(
      'SELECT * FROM receipts WHERE transaction_id = ? AND profile_id = ?',
      transactionId,
      profileId
    );
  }

  create(data) {
    return this.insert('receipts', data);
  }

  deleteByIdAndProfile(id, profileId) {
    return super.delete('receipts', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id) {
    return super.delete('receipts', 'id = ?', id);
  }
}

module.exports = { ReceiptsRepository };
