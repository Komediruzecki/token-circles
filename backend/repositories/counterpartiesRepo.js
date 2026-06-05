const { BaseRepository } = require('./baseRepo');

class CounterpartiesRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      `SELECT DISTINCT beneficiary as name FROM transactions
       WHERE profile_id = ? AND beneficiary IS NOT NULL AND beneficiary != ''
       UNION
       SELECT DISTINCT payor as name FROM transactions
       WHERE profile_id = ? AND payor IS NOT NULL AND payor != ''
       ORDER BY name`,
      profileId,
      profileId
    );
  }

  listWithStats(profileId) {
    const counterparties = [];
    const rows = this.all(
      `SELECT beneficiary as name, COUNT(*) as tx_count, SUM(amount) as total
       FROM transactions WHERE profile_id = ? AND beneficiary IS NOT NULL AND beneficiary != ''
       GROUP BY beneficiary`,
      profileId
    );
    counterparties.push(...rows.map((r) => ({ ...r, role: 'beneficiary' })));

    const payorRows = this.all(
      `SELECT payor as name, COUNT(*) as tx_count, SUM(amount) as total
       FROM transactions WHERE profile_id = ? AND payor IS NOT NULL AND payor != ''
       GROUP BY payor`,
      profileId
    );
    counterparties.push(...payorRows.map((r) => ({ ...r, role: 'payor' })));

    return counterparties;
  }
}

module.exports = { CounterpartiesRepository };
