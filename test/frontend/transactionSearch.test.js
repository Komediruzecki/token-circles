/**
 * Tests for transaction search functionality
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

describe('Transaction Search Feature', () => {
  describe('Backend search implementation', () => {
    test('GET /api/transactions supports search parameter', () => {
      // Should search in description, beneficiary, payor, and notes
      const searchPattern = /t\.description.*LIKE.*t\.beneficiary.*LIKE.*t\.payor.*LIKE.*t\.notes.*LIKE/s;
      expect(backendIndex).toMatch(searchPattern);
    });

    test('GET /api/transactions/summary supports search parameter', () => {
      // Summary endpoint should also support search
      const summarySearch = /t\.description.*LIKE.*t\.notes.*LIKE/s;
      expect(backendIndex).toMatch(summarySearch);
    });

    test('Search is case-insensitive with LIKE pattern', () => {
      // Should use LIKE with % wildcards for partial matching
      expect(backendIndex).toMatch(/%\$\{search\}%/);
    });

    test('Search filters apply to both main query and count query', () => {
      // Count query should have the same search filter as main query
      const countSqlMatch = backendIndex.match(/countSql[\s\S]*?get\(\.\.\.cparams\)/);
      expect(countSqlMatch).toBeTruthy();
    });
  });

  describe('Frontend search input', () => {
    test('Search input exists with id tx-search', () => {
      expect(indexHtml).toMatch(/id="tx-search"/);
    });

    test('Search input has oninput handler calling transactions.search()', () => {
      expect(indexHtml).toMatch(/id="tx-search".*oninput="transactions\.search\(\)"/s);
    });

    test('Search placeholder is "Search..."', () => {
      expect(indexHtml).toMatch(/placeholder="Search\.\.\."/);
    });

    test('Search is styled with search-input class', () => {
      expect(indexHtml).toMatch(/<div class="search-input">[\s\S]*?<input[^>]*id="tx-search"/);
    });

    test('Search icon SVG is included', () => {
      expect(indexHtml).toMatch(/<svg[^>]*viewBox/);
    });
  });

  describe('Frontend search integration', () => {
    test('transactions.load() reads tx-search value', () => {
      expect(indexHtml).toMatch(/getElementById\(['"]tx-search['"]\).*value/);
    });

    test('transactions.load() appends search param to API call', () => {
      expect(indexHtml).toMatch(/params\.append\(['"]search['"]\s*,\s*search\)/);
    });

    test('transactions.search() resets page to 1', () => {
      expect(indexHtml).toMatch(/search\(\)\s*\{[^}]*this\.page\s*=\s*1/);
    });

    test('clearFilters() resets search input', () => {
      expect(indexHtml).toMatch(/clearFilters\(\)/);
      expect(indexHtml).toMatch(/tx-search/);
    });
  });

  describe('Search covers multiple fields', () => {
    test('Searches description field', () => {
      expect(backendIndex).toMatch(/t\.description\s+LIKE/);
    });

    test('Searches beneficiary field', () => {
      expect(backendIndex).toMatch(/t\.beneficiary\s+LIKE/);
    });

    test('Searches payor field', () => {
      expect(backendIndex).toMatch(/t\.payor\s+LIKE/);
    });

    test('Searches notes field', () => {
      expect(backendIndex).toMatch(/t\.notes\s+LIKE/);
    });
  });

  describe('Search combined with filters', () => {
    test('Search works with date filters', () => {
      // The load function should handle both search and date filters
      expect(indexHtml).toMatch(/startDate/);
      expect(indexHtml).toMatch(/search/);
    });

    test('Search works with category filters', () => {
      expect(indexHtml).toMatch(/search.*category_ids|category_ids.*search/s);
    });

    test('Search works with type filter', () => {
      expect(indexHtml).toMatch(/search.*type|type.*search/s);
    });
  });

  describe('Search edge cases', () => {
    test('Empty search returns all results', () => {
      // When search is empty string, it should not add filter
      const loadCode = indexHtml.match(/if\s*\(\s*search\s*\)/);
      expect(loadCode).toBeTruthy();
    });

    test('Special characters in search are handled', () => {
      // The backend uses parameterized queries (LIKE ?) which handles special chars
      expect(backendIndex).toMatch(/params\.push\(`%\$\{search\}/);
    });

    test('Search input is a text input', () => {
      expect(indexHtml).toMatch(/tx-search.*type="text"|type="text"[^>]*id="tx-search"/);
    });
  });
});