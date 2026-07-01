const { BaseRepository } = require('./baseRepo');

class TagsRepository extends BaseRepository {
  list(profileId) {
    return this.all(
      'SELECT id, name, color, created_at FROM tags WHERE profile_id = ? ORDER BY name',
      profileId
    );
  }

  getById(id, profileId) {
    return this.get(
      'SELECT id, name, color, created_at FROM tags WHERE id = ? AND profile_id = ?',
      id,
      profileId
    );
  }

  getByName(name, profileId) {
    return this.get(
      'SELECT id, name, color, created_at FROM tags WHERE name = ? AND profile_id = ?',
      name,
      profileId
    );
  }

  create(data) {
    return this.insert('tags', data);
  }

  update(id, profileId, data) {
    return super.update('tags', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('tags', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteAll(profileId) {
    return super.delete('tags', 'profile_id = ?', profileId);
  }

  getTagsForTransaction(transactionId, profileId) {
    return this.all(
      `SELECT t.id, t.name, t.color
       FROM tags t
       JOIN transaction_tags tt ON t.id = tt.tag_id
       WHERE tt.transaction_id = ? AND t.profile_id = ?
       ORDER BY t.name`,
      transactionId,
      profileId
    );
  }

  // Batch form of getTagsForTransaction: one query for a whole page of transactions instead of
  // one per row (the list endpoint attached tags in an N+1 loop). Returns a
  // Map<transaction_id, tag[]>, scoped to the given profile(s) to match the per-row call.
  getTagsForTransactions(transactionIds, profileIds) {
    const byTx = new Map();
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) return byTx;
    const txPlaceholders = transactionIds.map(() => '?').join(',');
    const profPlaceholders = profileIds.map(() => '?').join(',');
    const rows = this.all(
      `SELECT tt.transaction_id, t.id, t.name, t.color
       FROM tags t
       JOIN transaction_tags tt ON t.id = tt.tag_id
       WHERE t.profile_id IN (${profPlaceholders}) AND tt.transaction_id IN (${txPlaceholders})
       ORDER BY t.name`,
      ...profileIds,
      ...transactionIds
    );
    for (const r of rows) {
      const list = byTx.get(r.transaction_id) || [];
      list.push({ id: r.id, name: r.name, color: r.color });
      byTx.set(r.transaction_id, list);
    }
    return byTx;
  }

  setTransactionTags(transactionId, tagIds, profileId) {
    this.run('DELETE FROM transaction_tags WHERE transaction_id = ?', transactionId);
    if (!Array.isArray(tagIds) || tagIds.length === 0) return;
    // Only attach tags owned by this profile — prevents attaching another tenant's tag id.
    const placeholders = tagIds.map(() => '?').join(',');
    const owned = this.all(
      `SELECT id FROM tags WHERE profile_id = ? AND id IN (${placeholders})`,
      profileId,
      ...tagIds
    );
    const insertStmt = this.db.prepare(
      'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)'
    );
    for (const row of owned) {
      insertStmt.run(transactionId, row.id);
    }
  }

  getTransactionsByTag(tagId, profileId, filters = {}) {
    let sql = `
      SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
      JOIN transaction_tags tt ON t.id = tt.transaction_id
      WHERE t.profile_id = ? AND tt.tag_id = ?
    `;
    const params = [profileId, tagId];

    if (filters.startDate) {
      sql += ' AND t.date >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ' AND t.date <= ?';
      params.push(filters.endDate);
    }
    if (filters.category_ids) {
      const ids = filters.category_ids
        .split(',')
        .map(Number)
        .filter((n) => !isNaN(n));
      if (ids.length > 0) {
        sql += ` AND t.category_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }
    if (filters.type) {
      sql += ' AND t.type = ?';
      params.push(filters.type);
    }

    sql += ' ORDER BY t.date DESC, t.id DESC';
    if (filters.limit) {
      const lim = parseInt(filters.limit);
      if (!isNaN(lim)) sql += ` LIMIT ${Math.min(lim, 1000)}`;
    }
    if (filters.offset) {
      const off = parseInt(filters.offset);
      if (!isNaN(off)) sql += ` OFFSET ${off}`;
    }

    return this.all(sql, ...params);
  }
}

module.exports = { TagsRepository };
