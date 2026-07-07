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

  /** Reject any column/identifier that isn't a bare alphanumeric_underscore name. */
  _validateColumns(columns) {
    for (const col of columns) {
      if (!/^[a-zA-Z0-9_]+$/.test(col)) {
        throw new Error(`Invalid column name: ${col}`);
      }
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
    this._validateColumns(keys);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
    return this.run(sql, ...Object.values(data));
  }

  /** UPDATE rows matching where clause — where is required */
  update(table, data, where, ...params) {
    this._validateTable(table);
    if (!where) throw new Error('update requires a WHERE clause');
    const cols = Object.keys(data);
    this._validateColumns(cols);
    const sets = cols.map((k) => `${k} = ?`).join(', ');
    const sql = `UPDATE ${table} SET ${sets} WHERE ${where}`;
    return this.run(sql, ...Object.values(data), ...params);
  }

  /** Return { [groupValue]: count } map */
  countsByProfile(table, profileCol = 'profile_id') {
    this._validateTable(table);
    this._validateColumns([profileCol]);
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

  /**
   * Verify that an account belongs to the given profile. Callers MUST validate
   * account ownership before accepting account_id from client input — otherwise
   * a user can reference another user's account, polluting transaction data with
   * cross-profile account references.
   */
  accountBelongsToProfile(accountId, profileId) {
    // Short-circuit: reject non-integer / non-positive values before hitting the DB.
    if (!Number.isInteger(accountId) || accountId <= 0) return false;
    const row = this.get(
      'SELECT id FROM accounts WHERE id = ? AND profile_id = ?',
      accountId,
      profileId
    );
    return row !== undefined;
  }

  /**
   * Execute a callback inside a better-sqlite3 transaction. If the callback
   * throws, the transaction is rolled back. All repos share the same `db`
   * instance, so cross-repo operations inside the callback are atomic.
   */
  transaction(fn) {
    return this.db.transaction(fn)();
  }
}

module.exports = { BaseRepository };
