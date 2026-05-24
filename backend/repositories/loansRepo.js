const { BaseRepository } = require('./baseRepo')

class LoansRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT * FROM loans WHERE profile_id = ? ORDER BY created_at DESC',
      profileId
    )
  }

  getById(id, profileId) {
    return this.get('SELECT * FROM loans WHERE id = ? AND profile_id = ?', id, profileId)
  }

  create(data) {
    return this.insert('loans', data)
  }

  update(id, profileId, data) {
    return this.update('loans', data, 'id = ? AND profile_id = ?', id, profileId)
  }

  deleteById(id, profileId) {
    return this.delete('loans', 'id = ? AND profile_id = ?', id, profileId)
  }

  deleteAll(profileId) {
    return this.delete('loans', 'profile_id = ?', profileId)
  }

  getRatePeriods(loanId) {
    return this.all(
      'SELECT * FROM loan_rate_periods WHERE loan_id = ? ORDER BY start_month', loanId
    )
  }

  addRatePeriod(data) {
    return this.insert('loan_rate_periods', data)
  }

  updateRatePeriod(id, loanId, data) {
    return this.update('loan_rate_periods', data, 'id = ? AND loan_id = ?', id, loanId)
  }

  deleteRatePeriodById(id, loanId) {
    return this.delete('loan_rate_periods', 'id = ? AND loan_id = ?', id, loanId)
  }

  getPrepayments(loanId) {
    return this.all(
      'SELECT * FROM loan_prepayments WHERE loan_id = ? ORDER BY month', loanId
    )
  }

  addPrepayment(data) {
    return this.insert('loan_prepayments', data)
  }

  deleteRatePeriods(loanId) {
    return this.delete('loan_rate_periods', 'loan_id = ?', loanId)
  }

  deletePrepayment(id, loanId) {
    return this.delete('loan_prepayments', 'id = ? AND loan_id = ?', id, loanId)
  }
}

module.exports = { LoansRepository }
