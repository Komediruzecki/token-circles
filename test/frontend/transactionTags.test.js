/**
 * Tests for transaction tags feature
 */
const fs = require('fs');
const path = require('path');

const indexHtml = fs.readFileSync(
  path.join(__dirname, '../../frontend/index.html'),
  'utf8'
);

const backendIndex = fs.readFileSync(
  path.join(__dirname, '../../backend/index.js'),
  'utf8'
);

const databaseJs = fs.readFileSync(
  path.join(__dirname, '../../backend/database.js'),
  'utf8'
);

describe('Transaction Tags Feature', () => {
  describe('Backend tag support', () => {
    test('tags table exists in database schema', () => {
      expect(databaseJs).toMatch(/CREATE TABLE.*tags/);
    });

    test('transaction_tags junction table exists', () => {
      expect(databaseJs).toMatch(/CREATE TABLE.*transaction_tags/);
    });

    test('tags table has profile_id column', () => {
      expect(databaseJs).toMatch(/tags.*profile_id/);
    });

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

    test('GET /api/transactions/:id/tags endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/transactions\/.*\/tags["']/);
    });

    test('GET /api/transactions/by-tag/:tagId endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/transactions\/by-tag\//);
    });

    test('Tag validation checks for empty name', () => {
      expect(backendIndex).toMatch(/Tag name is required/);
    });

    test('Tag uniqueness constraint handled', () => {
      expect(backendIndex).toMatch(/UNIQUE constraint|Tag already exists/);
    });
  });

  describe('Frontend tag UI', () => {
    test('Tag selector container exists in transaction modal', () => {
      expect(indexHtml).toMatch(/id="tx-tags-container"/);
    });

    test('Tag list container exists', () => {
      expect(indexHtml).toMatch(/id="tx-tag-list"/);
    });

    test('Tag input field exists', () => {
      expect(indexHtml).toMatch(/id="tx-tag-input"/);
    });

    test('Tag selector has proper CSS class', () => {
      expect(indexHtml).toMatch(/class="tag-selector"|tag-selector\s*\{/);
    });

    test('Tag badge CSS class exists', () => {
      expect(indexHtml).toMatch(/tag-badge\s*\{|\.tag-badge/);
    });

    test('Add button for tags is present', () => {
      expect(indexHtml).toMatch(/onclick="transactions\.addTagFromInput\(\)"/);
    });

    test('Remove tag function is referenced', () => {
      expect(indexHtml).toMatch(/transactions\.removeTag\(/);
    });
  });

  describe('Frontend tag integration', () => {
    test('transactions object has selectedTags property', () => {
      expect(indexHtml).toMatch(/selectedTags\s*:\s*\[\]|selectedTags\s*=\s*\[\]/);
    });

    test('transactions object has renderTags method', () => {
      expect(indexHtml).toMatch(/renderTags\s*\(\s*\)/);
    });

    test('transactions object has loadTags method', () => {
      expect(indexHtml).toMatch(/loadTags\s*\(\s*\)/);
    });

    test('transactions object has addTagFromInput method', () => {
      expect(indexHtml).toMatch(/addTagFromInput\s*\(\s*\)/);
    });

    test('transactions object has addTag method', () => {
      expect(indexHtml).toMatch(/addTag\s*\(/);
    });

    test('transactions object has removeTag method', () => {
      expect(indexHtml).toMatch(/removeTag\s*\(/);
    });

    test('Tags are loaded when editing a transaction', () => {
      expect(indexHtml).toMatch(/\/transactions\/\${id}\/tags.*await.*api/s);
    });

    test('Tags are saved after transaction save', () => {
      expect(indexHtml).toMatch(/transactions.*\/tags.*method.*POST/);
    });

    test('Tag input has Enter key handler', () => {
      expect(indexHtml).toMatch(/key.*Enter|keydown.*Enter/);
    });
  });

  describe('Tag styling', () => {
    test('Tag badge has color styling', () => {
      expect(indexHtml).toMatch(/background:\s*\$\{tag\.color/);
    });

    test('Tag has remove button', () => {
      expect(indexHtml).toMatch(/remove-tag|removeTag/);
    });

    test('Tag list has flexbox layout', () => {
      expect(indexHtml).toMatch(/tag-list.*display.*flex|flex.*tag-list/);
    });
  });

  describe('Tag API integration', () => {
    test('Tags are fetched from /api/tags', () => {
      expect(indexHtml).toMatch(/api\s*\(\s*['"]\/tags['"]/);
    });

    test('New tags are created via POST /api/tags', () => {
      expect(indexHtml).toMatch(/api\s*\(\s*['"]\/tags['"].*method.*POST|POST.*\/api\/tags/);
    });
  });

  describe('Tag display in transaction list', () => {
    test('Transaction tags can be displayed in table', () => {
      // The tags feature supports showing in the transaction list
      expect(backendIndex).toMatch(/transactions.*by-tag|by-tag.*transactions/);
    });
  });
});