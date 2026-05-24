const { BaseRepository } = require('./baseRepo')

class AccountsRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT a.*, COALESCE((SELECT balance FROM account_balance_history bh WHERE bh.account_id = a.id ORDER BY bh.recorded_at DESC LIMIT 1), a.starting_balance, 0) as current_balance FROM accounts a WHERE a.profile_id = ? ORDER BY a.name',
      profileId
    )
  }

  getById(id, profileId) {
    return this.get('SELECT * FROM accounts WHERE id = ? AND profile_id = ?', id, profileId)
  }

  create(data) {
    return this.insert('accounts', data)
  }

  update(id, profileId, data) {
    return this.update('accounts', data, 'id = ? AND profile_id = ?', id, profileId)
  }

  deleteById(id, profileId) {
    return this.delete('accounts', 'id = ? AND profile_id = ?', id, profileId)
  }

  deleteAll(profileId) {
    return this.delete('accounts', 'profile_id = ?', profileId)
  }

  addBalanceEntry(accountId, balance, recordedAt, notes = '') {
    return this.insert('account_balance_history', {
      account_id: accountId, balance, recorded_at: recordedAt, notes
    })
  }

  getBalanceHistory(accountId) {
    return this.all(
      'SELECT * FROM account_balance_history WHERE account_id = ? ORDER BY recorded_at DESC',
      accountId
    )
  }

  deleteBalanceHistory(accountId) {
    return this.delete('account_balance_history', 'account_id = ?', accountId)
  }
}

module.exports = { AccountsRepository }
