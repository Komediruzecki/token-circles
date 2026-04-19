/**
 * Tests for account balance history tracking feature - backend only
 * Note: Frontend migrated to SolidJS - see src/features/Accounts.tsx
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

describe('Account Balance History - Backend API', () => {
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
});
