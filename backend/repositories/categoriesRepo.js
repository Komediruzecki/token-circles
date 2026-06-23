const { BaseRepository } = require('./baseRepo');

class CategoriesRepository extends BaseRepository {
  list(profileId, type) {
    let sql = 'SELECT * FROM categories WHERE profile_id = ?';
    const params = [profileId];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY type, name';
    return this.all(sql, ...params);
  }

  getById(id, profileId) {
    return this.get('SELECT * FROM categories WHERE id = ? AND profile_id = ?', id, profileId);
  }

  getByName(name, profileId) {
    return this.get('SELECT id FROM categories WHERE name = ? AND profile_id = ?', name, profileId);
  }

  create(data) {
    return this.insert('categories', data);
  }

  update(id, profileId, data) {
    return super.update('categories', data, 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteById(id, profileId) {
    return super.delete('categories', 'id = ? AND profile_id = ?', id, profileId);
  }

  deleteAll(profileId) {
    return super.delete('categories', 'profile_id = ?', profileId);
  }

  seedDefaults(profileId, defaults) {
    const insertCat = this.db.prepare(
      'INSERT INTO categories (profile_id, name, color, icon, type, tax_deductible) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const cat of defaults) {
      insertCat.run(
        profileId,
        cat.name,
        cat.color,
        cat.icon || '',
        cat.type,
        cat.tax_deductible ? 1 : 0
      );
    }
  }

  // Category mappings (learned patterns for auto-categorization)

  getMapping(profileId, pattern) {
    return this.get(
      'SELECT id, use_count FROM category_mappings WHERE profile_id = ? AND pattern = ?',
      profileId,
      pattern
    );
  }

  updateMapping(id, categoryId, confidence, useCount) {
    return this.run(
      'UPDATE category_mappings SET category_id = ?, confidence = ?, use_count = ? WHERE id = ?',
      categoryId,
      confidence,
      useCount
    );
  }

  insertMapping(profileId, pattern, categoryId, confidence) {
    return this.run(
      'INSERT INTO category_mappings (profile_id, pattern, category_id, confidence, use_count) VALUES (?, ?, ?, ?, ?)',
      profileId,
      pattern,
      categoryId,
      confidence,
      1
    );
  }

  upsertMapping(profileId, pattern, categoryId, confidence) {
    const existing = this.getMapping(profileId, pattern);
    if (existing) {
      const newUseCount = (existing.use_count || 0) + 1;
      this.updateMapping(existing.id, categoryId, confidence || 0.9, newUseCount);
      return { id: existing.id, use_count: newUseCount, updated: true };
    } else {
      const info = this.db.prepare(
        'INSERT INTO category_mappings (profile_id, pattern, category_id, confidence, use_count) VALUES (?, ?, ?, ?, ?)'
      ).run(profileId, pattern, categoryId, confidence || 0.9, 1);
      return { id: info.lastInsertRowid, use_count: 1, updated: false };
    }
  }

  listMappings(profileId) {
    return this.all(
      'SELECT cm.pattern, cm.category_id, cm.confidence, cm.use_count FROM category_mappings cm WHERE cm.profile_id = ?',
      profileId
    );
  }
}

module.exports = { CategoriesRepository };
