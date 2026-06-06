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

  setTransactionTags(transactionId, tagIds) {
    this.run('DELETE FROM transaction_tags WHERE transaction_id = ?', transactionId);
    const insertStmt = this.db.prepare(
      'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)'
    );
    for (const tagId of tagIds) {
      insertStmt.run(transactionId, tagId);
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

    if (filters.startDate) { sql += ' AND t.date >= ?'; params.push(filters.startDate); }
    if (filters.endDate) { sql += ' AND t.date <= ?'; params.push(filters.endDate); }
    if (filters.category_ids) {
      const ids = filters.category_ids.split(',').map(Number).filter((n) => !isNaN(n));
      if (ids.length > 0) {
        sql += ` AND t.category_id IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }
    if (filters.type) { sql += ' AND t.type = ?'; params.push(filters.type); }

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
