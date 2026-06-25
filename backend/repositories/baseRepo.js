/**
 * Base Repository — shared SQL helpers for all repository modules.
 * Each repo receives the better-sqlite3 `db` instance via its constructor.
 */

class BaseRepository {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this.db = db;
  }

  /** Run a prepared statement and return { changes, lastInsertRowid } */
  run(sql, ...params) {
    return this.db.prepare(sql).run(...params);
  }

  /** Run and return the single row, or undefined */
  get(sql, ...params) {
    return this.db.prepare(sql).get(...params);
  }

  /** Run and return all matching rows */
  all(sql, ...params) {
    return this.db.prepare(sql).all(...params);
  }

  _validateTable(table) {
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }
  }

  /** Return the count of rows matching the query */
  count(table, where = '', ...params) {
    this._validateTable(table);
    const sql = `SELECT COUNT(*) as c FROM ${table}${where ? ` WHERE ${where}` : ''}`;
    const row = this.get(sql, ...params);
    return row ? row.c : 0;
  }

  /** INSERT a row and return the run result { changes, lastInsertRowid } */
  insert(table, data) {
    this._validateTable(table);
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
    return this.run(sql, ...Object.values(data));
  }

  /** UPDATE rows matching where clause — where is required */
  update(table, data, where, ...params) {
    this._validateTable(table);
    if (!where) throw new Error('update requires a WHERE clause');
    const sets = Object.keys(data)
      .map((k) => `${k} = ?`)
      .join(', ');
    const sql = `UPDATE ${table} SET ${sets} WHERE ${where}`;
    return this.run(sql, ...Object.values(data), ...params);
  }

  /** Return { [groupValue]: count } map */
  countsByProfile(table, profileCol = 'profile_id') {
    this._validateTable(table);
    const rows = this.all(
      `SELECT ${profileCol}, COUNT(*) as c FROM ${table} GROUP BY ${profileCol}`
    );
    const map = {};
    for (const r of rows) map[r[profileCol]] = r.c;
    return map;
  }

  /** DELETE rows matching where clause — where is required */
  delete(table, where, ...params) {
    this._validateTable(table);
    if (!where) throw new Error('delete requires a WHERE clause');
    const sql = `DELETE FROM ${table} WHERE ${where}`;
    return this.run(sql, ...params);
  }
}

module.exports = { BaseRepository };
