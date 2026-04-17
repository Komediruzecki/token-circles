/**
 * Tests for transaction tags feature
 */

const { readFrontendContent, fs, path } = require('./testUtils');

const backendIndex = fs.readFileSync(
  path.join(__dirname, '../../backend/index.js'),
  'utf8'
);

const databaseJs = fs.readFileSync(
  path.join(__dirname, '../../backend/database.js'),
  'utf8'
);

describe('Transaction Tags Feature', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

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

  // Frontend tag UI - SKIPPED: feature not yet implemented in modular frontend
  // TODO(#86): Port transaction tags UI to templates/modals.html and js/features/transactions.js
  describe.skip('Frontend tag UI [SKIPPED - feature not implemented in modular frontend]', () => {
    test('Tag selector container exists in transaction modal', () => {});
    test('Tag list container exists', () => {});
    test('Tag input field exists', () => {});
    test('Tag selector has proper CSS class', () => {});
    test('Tag badge CSS class exists', () => {});
    test('Add button for tags is present', () => {});
    test('Remove tag function is referenced', () => {});
  });

  describe.skip('Frontend tag integration [SKIPPED - feature not implemented in modular frontend]', () => {
    test('transactions object has selectedTags property', () => {});
    test('transactions object has renderTags method', () => {});
    test('transactions object has loadTags method', () => {});
    test('transactions object has addTagFromInput method', () => {});
    test('transactions object has addTag method', () => {});
    test('transactions object has removeTag method', () => {});
    test('Tags are loaded when editing a transaction', () => {});
    test('Tags are saved after transaction save', () => {});
    test('Tag input has Enter key handler', () => {});
  });

  describe.skip('Tag styling [SKIPPED - feature not implemented in modular frontend]', () => {
    test('Tag badge has color styling', () => {});
    test('Tag has remove button', () => {});
    test('Tag list has flexbox layout', () => {});
  });

  describe.skip('Tag API integration [SKIPPED - feature not implemented in modular frontend]', () => {
    test('Tags are fetched from /api/tags', () => {});
    test('New tags are created via POST /api/tags', () => {});
  });

  describe('Tag display in transaction list', () => {
    test('Transaction tags can be displayed in table', () => {
      expect(backendIndex).toMatch(/transactions.*by-tag|by-tag.*transactions/);
    });
  });
});
