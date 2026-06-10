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
}

module.exports = { CategoriesRepository };
