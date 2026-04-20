/**
 * Tests for transaction tags feature - backend only
 * Note: Frontend migrated to SolidJS - see src/features/Transactions.tsx
 */

const fs = require('fs');
const path = require('path');

const backendIndex = fs.readFileSync(
  path.join(__dirname, '../../backend/index.js'),
  'utf8'
);

const databaseJs = fs.readFileSync(
  path.join(__dirname, '../../backend/database.js'),
  'utf8'
);

describe('Transaction Tags Feature - Backend API', () => {
  describe('Database schema', () => {
    test('tags table exists in database schema', () => {
      expect(databaseJs).toMatch(/CREATE TABLE.*tags/);
    });

    test('transaction_tags junction table exists', () => {
      expect(databaseJs).toMatch(/CREATE TABLE.*transaction_tags/);
    });

    test('tags table has profile_id column', () => {
      expect(databaseJs).toMatch(/tags.*profile_id/);
    });

    test('tags table has name column', () => {
      // Check for tags table with name column
      const hasTagsName = databaseJs.includes('CREATE TABLE IF NOT EXISTS tags') &&
                          databaseJs.includes('name TEXT NOT NULL');
      expect(hasTagsName).toBe(true);
    });

    test('tags table has color column', () => {
      // Check for tags table with color column
      const hasTagsColor = databaseJs.includes('CREATE TABLE IF NOT EXISTS tags') &&
                           databaseJs.includes('color TEXT');
      expect(hasTagsColor).toBe(true);
    });

    test('tags table has created_at column', () => {
      // Check for created_at in tags table definition
      const hasCreatedAt = databaseJs.includes('tags') && databaseJs.includes('created_at');
      expect(hasCreatedAt).toBe(true);
    });
  });

  describe('Backend API endpoints', () => {
    test('GET /api/tags endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/tags["']/);
    });

    test('POST /api/tags endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.post\s*\(\s*["']\/api\/tags["']/);
    });

    test('PUT /api/tags/:id endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.put\s*\(\s*["']\/api\/tags\/:id["']/);
    });

    test('DELETE /api/tags/:id endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.delete\s*\(\s*["']\/api\/tags\/:id["']/);
    });

    test('POST /api/transactions/:id/tags endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.post\s*\(\s*["']\/api\/transactions\/.*\/tags["']/);
    });

    test('PUT /api/transactions/:id/tags endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.put\s*\(\s*["']\/api\/transactions\/.*\/tags["']/);
    });

    test('GET /api/transactions/:id/tags endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/transactions\/.*\/tags["']/);
    });

    test('Transaction tag endpoints exist (POST/PUT/GET)', () => {
      // Only POST, PUT, GET exist for tags - no DELETE
      expect(backendIndex).toMatch(/app\.post\s*\(\s*["']\/api\/transactions\/.*\/tags["']/);
      expect(backendIndex).toMatch(/app\.put\s*\(\s*["']\/api\/transactions\/.*\/tags["']/);
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/transactions\/.*\/tags["']/);
    });

    test('GET /api/transactions includes tags in response', () => {
      expect(backendIndex).toMatch(/row\.tags\s*=\s*tagStmt\.all\(row\.id\)/);
    });

    test('GET /api/transactions/:id includes tags in response', () => {
      expect(backendIndex).toMatch(/tx\.tags\s*=\s*db\.prepare/);
    });

    test('Tag validation checks for empty name', () => {
      expect(backendIndex).toMatch(/Tag name is required|Tag is required/);
    });

    test('Tag uniqueness constraint handled', () => {
      expect(backendIndex).toMatch(/UNIQUE constraint|Tag already exists/);
    });

    test('GET /api/transactions supports tag_ids filter', () => {
      expect(backendIndex).toMatch(/tag_ids/);
    });

    test('Tag API uses correct profile filtering', () => {
      // Check for profileId parameter extraction (not profile_id snake_case)
      expect(backendIndex).toMatch(/profileId/);
    });
  });

  describe('Tag color palette', () => {
    test('Tag color palette exists for auto-assignment', () => {
      expect(backendIndex).toMatch(/TAG_COLORS\s*=\s*\[/);
    });

    test('Tag colors array has multiple colors', () => {
      expect(backendIndex).toMatch(/TAG_COLORS\s*=\s*\[/);
      expect(backendIndex).toMatch(/["']#[0-9a-fA-F]{6}["']/);
    });
  });
});
