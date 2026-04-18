/**
 * Tests for transaction tags feature - frontend integration
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

const transactionsJs = fs.readFileSync(
  path.join(__dirname, '../../frontend/js/features/transactions.js'),
  'utf8'
);

const modalsHtml = fs.readFileSync(
  path.join(__dirname, '../../frontend/templates/modals.html'),
  'utf8'
);

const pagesHtml = fs.readFileSync(
  path.join(__dirname, '../../frontend/templates/pages.html'),
  'utf8'
);

const componentsCss = fs.readFileSync(
  path.join(__dirname, '../../frontend/css/components.css'),
  'utf8'
);

describe('Transaction Tags Feature - Frontend', () => {
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

    test('PUT /api/transactions/:id/tags endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.put\s*\(\s*["']\/api\/transactions\/.*\/tags["']/);
    });

    test('GET /api/transactions/:id/tags endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/transactions\/.*\/tags["']/);
    });

    test('GET /api/transactions includes tags in response', () => {
      expect(backendIndex).toMatch(/row\.tags\s*=\s*tagStmt\.all\(row\.id\)/);
    });

    test('GET /api/transactions/:id includes tags in response', () => {
      expect(backendIndex).toMatch(/tx\.tags\s*=\s*db\.prepare/);
    });

    test('Tag color palette exists for auto-assignment', () => {
      expect(backendIndex).toMatch(/TAG_COLORS\s*=\s*\[/);
    });

    test('Tag validation checks for empty name', () => {
      expect(backendIndex).toMatch(/Tag name is required/);
    });

    test('Tag uniqueness constraint handled', () => {
      expect(backendIndex).toMatch(/UNIQUE constraint|Tag already exists/);
    });

    test('GET /api/transactions supports tag_ids filter', () => {
      expect(backendIndex).toMatch(/tag_ids/);
    });
  });

  describe('Frontend tag UI', () => {
    test('Tag selector container exists in transaction modal', () => {
      expect(modalsHtml).toMatch(/tx-tag-selector/);
    });

    test('Tag chips container exists in modal', () => {
      expect(modalsHtml).toMatch(/tx-tag-chips/);
    });

    test('Tag new input exists in modal', () => {
      expect(modalsHtml).toMatch(/tx-tag-new-input/);
    });

    test('Tag input has Enter key handler', () => {
      expect(modalsHtml).toMatch(/data-action="transactions:addTagFromInput"/);
    });

    test('Tag CSS styles exist in components.css', () => {
      expect(componentsCss).toMatch(/\.tx-tag-chip/);
    });

    test('Tag filter container exists in pages.html', () => {
      expect(pagesHtml).toMatch(/tx-tag-filter-container/);
    });
  });

  describe('Frontend JS implementation', () => {
    test('transactions object has selectedTags property', () => {
      expect(transactionsJs).toMatch(/selectedTags\s*:/);
    });

    test('transactions object has loadTags method', () => {
      expect(transactionsJs).toMatch(/loadTags\s*\(\s*\)/);
    });

    test('transactions object has renderTagChips method', () => {
      expect(transactionsJs).toMatch(/renderTagChips\s*\(\s*\)/);
    });

    test('transactions object has toggleTag method', () => {
      expect(transactionsJs).toMatch(/toggleTag\s*\(\s*tagId\s*\)/);
    });

    test('transactions object has addTagFromInput method', () => {
      expect(transactionsJs).toMatch(/addTagFromInput\s*\(\s*\)/);
    });

    test('openModal loads tags and renders chips', () => {
      expect(transactionsJs).toMatch(/loadTags\(\)/);
      expect(transactionsJs).toMatch(/renderTagChips\(\)/);
    });

    test('save() includes tag IDs in PUT /transactions/:id/tags', () => {
      expect(transactionsJs).toMatch(/transactions\/\$\{txId\}\/tags/);
      expect(transactionsJs).toMatch(/tagIds.*selectedTags/);
    });

    test('Tag filter dropdown methods exist in txFilters', () => {
      expect(transactionsJs).toMatch(/initTagFilter\s*\(\s*\)/);
      expect(transactionsJs).toMatch(/onTagChange\s*\(\s*\)/);
      expect(transactionsJs).toMatch(/clearTagFilter\s*\(\s*\)/);
    });

    test('Tag IDs are included in buildFilterParams', () => {
      expect(transactionsJs).toMatch(/selectedTagIds/);
      expect(transactionsJs).toMatch(/tag_ids.*tagIds/);
    });

    test('renderTagPills helper exists', () => {
      expect(transactionsJs).toMatch(/function renderTagPills/);
    });

    test('hexToRgba helper exists via FM.Utils', () => {
      expect(transactionsJs).toMatch(/FM\.Utils\.hexToRgba/);
    });

    test('Tag pills rendered in transaction list rows', () => {
      expect(transactionsJs).toMatch(/renderTagPills\(t\.tags\)/);
    });
  });

  describe('Tag styling', () => {
    test('Tag chip CSS class exists with styling', () => {
      expect(componentsCss).toMatch(/\.tx-tag-chip\s*\{[^}]*display:\s*inline-flex/);
    });

    test('Tag pill styling exists', () => {
      expect(componentsCss).toMatch(/\.tx-tag-pill/);
    });

    test('Tag filter dropdown styling exists', () => {
      expect(componentsCss).toMatch(/\.tx-tag-filter-dropdown/);
    });
  });

  describe('Tag API integration', () => {
    test('Tags are fetched from /api/tags', () => {
      expect(transactionsJs).toMatch(/api\s*\(\s*['"]\/tags['"]/);
    });

    test('New tags are created via POST /api/tags', () => {
      expect(transactionsJs).toMatch(/api\s*\(\s*['"]\/tags['"].*method:\s*['"]POST['"]/);
    });
  });

  describe('Tag display in transaction list', () => {
    test('Transaction tags can be displayed in table', () => {
      expect(backendIndex).toMatch(/transactions.*by-tag|by-tag.*transactions/);
    });
  });
});
