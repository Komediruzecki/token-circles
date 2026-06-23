/**
 * Unit tests for BaseRepository — the foundation layer for all repositories.
 * Uses an in-memory SQLite database for fast, isolated tests.
 */

const Database = require('better-sqlite3');
const { BaseRepository } = require('../../../repositories/baseRepo');

describe('BaseRepository', () => {
  let db, repo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    repo = new BaseRepository(db);

    // Create a test table
    db.exec(`
      CREATE TABLE test_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value REAL DEFAULT 0,
        category TEXT DEFAULT 'general',
        priority INTEGER DEFAULT 1
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  // ---- INSERT ----
  describe('insert()', () => {
    it('should insert a row and return the run result', () => {
      const result = repo.insert('test_items', { name: 'Apple', value: 1.5 });
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(1);
    });

    it('should handle multiple columns', () => {
      const result = repo.insert('test_items', {
        name: 'Banana',
        value: 2.0,
        category: 'fruit',
        priority: 2,
      });
      expect(result.changes).toBe(1);

      const row = db.prepare('SELECT * FROM test_items WHERE id = ?').get(result.lastInsertRowid);
      expect(row.name).toBe('Banana');
      expect(row.value).toBe(2.0);
      expect(row.category).toBe('fruit');
      expect(row.priority).toBe(2);
    });

    it('should auto-increment IDs', () => {
      repo.insert('test_items', { name: 'First' });
      repo.insert('test_items', { name: 'Second' });
      repo.insert('test_items', { name: 'Third' });

      const rows = db.prepare('SELECT id FROM test_items ORDER BY id').all();
      expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    });
  });

  // ---- GET ----
  describe('get()', () => {
    beforeEach(() => {
      repo.insert('test_items', { name: 'Alpha', value: 10 });
      repo.insert('test_items', { name: 'Beta', value: 20 });
    });

    it('should return a single row by ID', () => {
      const row = repo.get('SELECT * FROM test_items WHERE id = ?', 1);
      expect(row.name).toBe('Alpha');
      expect(row.value).toBe(10);
    });

    it('should return undefined for no match', () => {
      const row = repo.get('SELECT * FROM test_items WHERE id = ?', 999);
      expect(row).toBeUndefined();
    });

    it('should return the first match when multiple rows match', () => {
      const row = repo.get('SELECT * FROM test_items ORDER BY id');
      expect(row.id).toBe(1);
    });
  });

  // ---- ALL ----
  describe('all()', () => {
    beforeEach(() => {
      repo.insert('test_items', { name: 'X', value: 1 });
      repo.insert('test_items', { name: 'Y', value: 2 });
      repo.insert('test_items', { name: 'Z', value: 3 });
    });

    it('should return all matching rows', () => {
      const rows = repo.all('SELECT * FROM test_items ORDER BY id');
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.name)).toEqual(['X', 'Y', 'Z']);
    });

    it('should return empty array when no rows match', () => {
      const rows = repo.all('SELECT * FROM test_items WHERE value > 100');
      expect(rows).toEqual([]);
    });

    it('should work with parameterized queries', () => {
      const rows = repo.all('SELECT * FROM test_items WHERE value > ?', 1);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.name)).toEqual(['Y', 'Z']);
    });
  });

  // ---- RUN ----
  describe('run()', () => {
    it('should report changes count on UPDATE', () => {
      repo.insert('test_items', { name: 'First' });
      repo.insert('test_items', { name: 'Second' });

      const result = repo.run("UPDATE test_items SET category = 'updated' WHERE name = 'First'");
      expect(result.changes).toBe(1);
    });

    it('should report 0 changes when no rows match', () => {
      const result = repo.run("UPDATE test_items SET category = 'updated' WHERE name = 'Nope'");
      expect(result.changes).toBe(0);
    });

    it('should report lastInsertRowid on INSERT', () => {
      const result = repo.run(
        "INSERT INTO test_items (name, value) VALUES ('dynamic', 42)"
      );
      expect(result.lastInsertRowid).toBeGreaterThan(0);
      expect(result.changes).toBe(1);
    });
  });

  // ---- COUNT ----
  describe('count()', () => {
    it('should return 0 for empty table', () => {
      expect(repo.count('test_items')).toBe(0);
    });

    it('should return total count for table', () => {
      repo.insert('test_items', { name: 'A' });
      repo.insert('test_items', { name: 'B' });
      repo.insert('test_items', { name: 'C' });
      expect(repo.count('test_items')).toBe(3);
    });

    it('should return filtered count with WHERE clause', () => {
      repo.insert('test_items', { name: 'A', category: 'fruit' });
      repo.insert('test_items', { name: 'B', category: 'fruit' });
      repo.insert('test_items', { name: 'C', category: 'veg' });
      expect(repo.count('test_items', 'category = ?', 'fruit')).toBe(2);
      expect(repo.count('test_items', 'category = ?', 'veg')).toBe(1);
      expect(repo.count('test_items', 'category = ?', 'meat')).toBe(0);
    });
  });

  // ---- UPDATE ----
  describe('update()', () => {
    beforeEach(() => {
      repo.insert('test_items', { name: 'Alpha', value: 10, category: 'old' });
      repo.insert('test_items', { name: 'Beta', value: 20, category: 'old' });
    });

    it('should update matching rows', () => {
      const result = repo.update('test_items', { category: 'new' }, 'id = ?', 1);
      expect(result.changes).toBe(1);

      const row = db.prepare('SELECT category FROM test_items WHERE id = ?').get(1);
      expect(row.category).toBe('new');
    });

    it('should update multiple columns', () => {
      repo.update('test_items', { name: 'Alpha Prime', value: 99 }, 'id = ?', 1);

      const row = db.prepare('SELECT name, value FROM test_items WHERE id = ?').get(1);
      expect(row.name).toBe('Alpha Prime');
      expect(row.value).toBe(99);
    });

    it('should NOT update rows that do not match', () => {
      repo.update('test_items', { category: 'new' }, 'id = ?', 1);

      const row2 = db.prepare('SELECT category FROM test_items WHERE id = ?').get(2);
      expect(row2.category).toBe('old');
    });

    it('should throw if no WHERE clause is provided', () => {
      expect(() => repo.update('test_items', { category: 'bad' }, '')).toThrow(
        'update requires a WHERE clause'
      );
    });
  });

  // ---- DELETE ----
  describe('delete()', () => {
    beforeEach(() => {
      repo.insert('test_items', { name: 'X' });
      repo.insert('test_items', { name: 'Y' });
      repo.insert('test_items', { name: 'Z' });
    });

    it('should delete matching rows', () => {
      const result = repo.delete('test_items', 'id = ?', 2);
      expect(result.changes).toBe(1);

      expect(repo.count('test_items')).toBe(2);
      const remaining = repo.all('SELECT id FROM test_items ORDER BY id');
      expect(remaining.map((r) => r.id)).toEqual([1, 3]);
    });

    it('should delete all rows if WHERE matches all', () => {
      const result = repo.delete('test_items', '1 = 1');
      expect(result.changes).toBe(3);
      expect(repo.count('test_items')).toBe(0);
    });

    it('should report 0 changes when no rows match', () => {
      const result = repo.delete('test_items', 'id = ?', 999);
      expect(result.changes).toBe(0);
      expect(repo.count('test_items')).toBe(3);
    });

    it('should throw if no WHERE clause is provided', () => {
      expect(() => repo.delete('test_items', '')).toThrow('delete requires a WHERE clause');
    });
  });

  // ---- COUNTS BY PROFILE ----
  describe('countsByProfile()', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE profile_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL,
          data TEXT
        );
      `);
      db.prepare('INSERT INTO profile_data (profile_id, data) VALUES (?, ?)').run(1, 'a');
      db.prepare('INSERT INTO profile_data (profile_id, data) VALUES (?, ?)').run(1, 'b');
      db.prepare('INSERT INTO profile_data (profile_id, data) VALUES (?, ?)').run(1, 'c');
      db.prepare('INSERT INTO profile_data (profile_id, data) VALUES (?, ?)').run(2, 'd');
      db.prepare('INSERT INTO profile_data (profile_id, data) VALUES (?, ?)').run(2, 'e');
    });

    it('should return counts grouped by profile_id', () => {
      const map = repo.countsByProfile('profile_data');
      expect(map).toEqual({ 1: 3, 2: 2 });
    });

    it('should return empty object for empty profile table', () => {
      db.exec(`
        CREATE TABLE empty_profile (
          id INTEGER PRIMARY KEY,
          profile_id INTEGER NOT NULL
        );
      `);
      const map = repo.countsByProfile('empty_profile');
      expect(map).toEqual({});
    });

    it('should work with custom profile column name', () => {
      db.exec(`
        CREATE TABLE org_data (
          id INTEGER PRIMARY KEY,
          org_id INTEGER NOT NULL,
          entry TEXT
        );
      `);
      db.prepare('INSERT INTO org_data (org_id, entry) VALUES (?, ?)').run(1, 'x');
      db.prepare('INSERT INTO org_data (org_id, entry) VALUES (?, ?)').run(1, 'y');

      const map = repo.countsByProfile('org_data', 'org_id');
      expect(map).toEqual({ 1: 2 });
    });
  });

  // ---- EDGE CASES ----
  describe('edge cases', () => {
    it('should handle SQL with no parameters', () => {
      const result = repo.run("create table if not exists dynamic_t (id integer)");
      // SQLite CREATE TABLE returns no changes count
      expect(result).toBeDefined();
    });

    it('should handle empty data object on insert', () => {
      // Inserting with empty data should fail gracefully
      // Add a col to verify: INSERT INTO test_items () VALUES () would need all cols nullable/defaulted
      // For this table, name is NOT NULL so we can't insert empty
      expect(() => repo.insert('test_items', {})).toThrow();
    });

    it('should handle special characters in values', () => {
      repo.insert('test_items', { name: "O'Brien's Café" });
      const row = repo.get('SELECT * FROM test_items WHERE id = ?', 1);
      expect(row.name).toBe("O'Brien's Café");
    });

    it('should handle NULL values', () => {
      // value column allows NULL (has DEFAULT 0)
      repo.insert('test_items', { name: 'Null Value', value: null, category: null });
      const row = repo.get('SELECT * FROM test_items WHERE id = ?', 1);
      expect(row.name).toBe('Null Value');
      expect(row.value).toBeNull();
      expect(row.category).toBeNull();
    });

    it('should handle very large strings', () => {
      const bigName = 'A'.repeat(10000);
      repo.insert('test_items', { name: bigName });
      const row = repo.get('SELECT * FROM test_items WHERE id = ?', 1);
      expect(row.name).toHaveLength(10000);
    });

    it('should handle Unicode characters', () => {
      repo.insert('test_items', { name: '日本語テスト 🎉' });
      const row = repo.get('SELECT * FROM test_items WHERE id = ?', 1);
      expect(row.name).toBe('日本語テスト 🎉');
    });
  });
});
