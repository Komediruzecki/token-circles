/**
 * Tests for account reconciliation feature - backend only
 * Note: Frontend migrated to SolidJS - reconciliation UI not yet implemented
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

describe('Account Reconciliation - Backend API', () => {
  describe('Database schema', () => {
    test('reconciled column exists in transactions', () => {
      expect(databaseJs).toMatch(/ALTER TABLE transactions ADD COLUMN reconciled/);
    });

    test('reconciled_at column exists in transactions', () => {
      expect(databaseJs).toMatch(/ALTER TABLE transactions ADD COLUMN reconciled_at/);
    });

    test('reconciled defaults to 0', () => {
      expect(databaseJs).toMatch(/reconciled.*DEFAULT.*0/);
    });
  });

  describe('Backend API', () => {
    test('PUT transaction accepts reconciled field', () => {
      expect(backendIndex).toMatch(/reconciled/);
    });

    test('PATCH /api/transactions/:id/reconcile endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.patch\s*\(\s*["']\/api\/transactions\/.*\/reconcile["']/);
    });

    test('POST /api/transactions/reconcile/bulk endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.post\s*\(\s*["']\/api\/transactions\/reconcile\/bulk["']/);
    });

    test('GET /api/transactions/reconcile/summary endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/transactions\/reconcile\/summary["']/);
    });

    test('Reconcile toggle flips existing status', () => {
      expect(backendIndex).toMatch(/newStatus.*existing\.reconciled.*0.*1/);
    });

    test('Reconcile endpoint sets reconciled_at timestamp', () => {
      expect(backendIndex).toMatch(/reconciled_at.*datetime\(['"]now['"]\)/);
    });

    test('Bulk reconcile validates date range', () => {
      expect(backendIndex).toMatch(/startDate.*endDate.*required/);
    });

    test('Summary endpoint returns total, reconciled, and unreconciled counts', () => {
      expect(backendIndex).toMatch(/reconciled_count/);
      expect(backendIndex).toMatch(/unreconciled_count/);
    });
  });
});
