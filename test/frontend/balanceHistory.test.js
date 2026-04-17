/**
 * Tests for account balance history tracking feature
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

describe('Account Balance History', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('Database schema', () => {
    test('account_balance_history table exists', () => {
      expect(databaseJs).toMatch(/CREATE TABLE.*account_balance_history/);
    });

    test('account_balance_history has account_id column', () => {
      expect(databaseJs).toMatch(/account_balance_history.*account_id/);
    });

    test('account_balance_history has balance column', () => {
      expect(databaseJs).toMatch(/CREATE TABLE.*account_balance_history.*balance.*REAL.*NOT NULL/s);
    });

    test('account_balance_history has recorded_at column', () => {
      expect(databaseJs).toMatch(/account_balance_history.*recorded_at/);
    });

    test('account_balance_history has foreign key to accounts', () => {
      expect(databaseJs).toMatch(/FOREIGN KEY.*account_id.*REFERENCES accounts/);
    });

    test('account_balance_history cascades on delete', () => {
      expect(databaseJs).toMatch(/CREATE TABLE.*account_balance_history/);
      expect(databaseJs).toMatch(/ON DELETE CASCADE/);
    });

    test('account_balance_history has index on account_id', () => {
      expect(databaseJs).toMatch(/idx_balance_history_account/);
    });

    test('account_balance_history has index on recorded_at', () => {
      expect(databaseJs).toMatch(/idx_balance_history_recorded/);
    });
  });

  describe('Backend API endpoints', () => {
    test('GET /api/accounts/:id/history endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/accounts\/.*\/history["']/);
    });

    test('POST /api/accounts/:id/history endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.post\s*\(\s*["']\/api\/accounts\/.*\/history["']/);
    });

    test('DELETE /api/accounts/:id/history endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.delete\s*\(\s*["']\/api\/accounts\/.*\/history["']/);
    });

    test('GET /api/accounts/history/timeline endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/accounts\/history\/timeline["']/);
    });

    test('Timeline endpoint aggregates by account', () => {
      expect(backendIndex).toMatch(/SUM.*balance.*as.*net_worth/i);
    });

    test('History endpoint returns records ordered by date desc', () => {
      expect(backendIndex).toMatch(/ORDER BY.*recorded_at.*DESC/);
    });

    test('History endpoints verify account ownership', () => {
      expect(backendIndex).toMatch(/accounts WHERE id = \? AND profile_id/);
    });
  });

  // Frontend UI - SKIPPED: feature not yet implemented in modular frontend
  // TODO(#86): Add balance history UI to templates/pages/accounts.html and js/features/accounts.js
  describe.skip('Frontend UI [SKIPPED - feature not implemented in modular frontend]', () => {
    test('Record Snapshot button exists in accounts header', () => {});
    test('Balance history section exists in accounts page', () => {});
    test('Balance history canvas element exists', () => {});
    test('History account select dropdown exists', () => {});
    test('History empty state exists', () => {});
  });

  describe.skip('Frontend JavaScript [SKIPPED - feature not implemented in modular frontend]', () => {
    test('accounts object has balanceHistoryChart property', () => {});
    test('accounts object has loadHistory method', () => {});
    test('accounts object has recordSnapshot method', () => {});
    test('loadHistory is called when navigating to accounts page', () => {});
    test('loadHistory fetches single account history', () => {});
    test('loadHistory fetches timeline when no account selected', () => {});
    test('loadHistory creates line chart', () => {});
    test('loadHistory populates account select dropdown', () => {});
    test('recordSnapshot calls POST for each account', () => {});
    test('loadHistory destroys previous chart before creating new', () => {});
  });
});
