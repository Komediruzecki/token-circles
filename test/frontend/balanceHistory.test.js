/**
 * Tests for account balance history tracking feature
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

describe('Account Balance History', () => {
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

  describe('Frontend UI', () => {
    test('Record Snapshot button exists in accounts header', () => {
      expect(indexHtml).toMatch(/Record Snapshot|Record snapshot/);
    });

    test('Balance history section exists in accounts page', () => {
      expect(indexHtml).toMatch(/id="balance-history-section"|Balance History/);
    });

    test('Balance history canvas element exists', () => {
      expect(indexHtml).toMatch(/id="chart-balance-history"/);
    });

    test('History account select dropdown exists', () => {
      expect(indexHtml).toMatch(/id="history-account-select"/);
    });

    test('History empty state exists', () => {
      expect(indexHtml).toMatch(/id="history-empty"/);
    });
  });

  describe('Frontend JavaScript', () => {
    test('accounts object has balanceHistoryChart property', () => {
      expect(indexHtml).toMatch(/balanceHistoryChart\s*:/);
    });

    test('accounts object has loadHistory method', () => {
      expect(indexHtml).toMatch(/loadHistory\s*\(\s*\)/);
    });

    test('accounts object has recordSnapshot method', () => {
      expect(indexHtml).toMatch(/recordSnapshot\s*\(\s*\)/);
    });

    test('loadHistory is called when navigating to accounts page', () => {
      expect(indexHtml).toMatch(/accounts\.loadHistory/);
    });

    test('loadHistory fetches single account history', () => {
      expect(indexHtml).toMatch(/\/accounts\/\$\{accountId\}\/history/);
    });

    test('loadHistory fetches timeline when no account selected', () => {
      expect(indexHtml).toMatch(/\/accounts\/history\/timeline/);
    });

    test('loadHistory creates line chart', () => {
      expect(indexHtml).toMatch(/type:\s*['"]line['"]/);
    });

    test('loadHistory populates account select dropdown', () => {
      expect(indexHtml).toMatch(/getElementById\(['"]history-account-select['"]\)/);
      expect(indexHtml).toMatch(/select\.innerHTML\s*=/);
    });

    test('recordSnapshot calls POST for each account', () => {
      expect(indexHtml).toMatch(/accounts\/\$\{acc\.id\}\/history.*method.*POST/);
    });

    test('loadHistory destroys previous chart before creating new', () => {
      expect(indexHtml).toMatch(/balanceHistoryChart\.destroy/);
    });
  });
});
