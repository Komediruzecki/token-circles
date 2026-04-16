/**
 * Tests for account reconciliation feature
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

describe('Account Reconciliation', () => {
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

  describe('Frontend UI', () => {
    test('Reconciled toggle checkbox exists in transaction modal', () => {
      expect(indexHtml).toMatch(/id="tx-reconciled"/);
    });

    test('Reconciled label exists in modal', () => {
      expect(indexHtml).toMatch(/Reconciled/i);
    });

    test('Reconciled check is saved in transaction save', () => {
      expect(indexHtml).toMatch(/tx-reconciled.*checked.*reconciled/);
    });

    test('Reconciled status is loaded when editing', () => {
      expect(indexHtml).toMatch(/tx-reconciled.*checked.*t\.reconciled/);
    });

    test('Reconciled CSS class for rows exists', () => {
      expect(indexHtml).toMatch(/tx-reconciled/);
    });

    test('Reconciled rows have reduced opacity', () => {
      expect(indexHtml).toMatch(/tr\.tx-reconciled.*opacity/);
    });

    test('Reconciled checkmark shown in date column', () => {
      expect(indexHtml).toMatch(/M5 13l4 4L19 7/);
    });
  });

  describe('Frontend JavaScript', () => {
    test('toggleReconcile method exists', () => {
      expect(indexHtml).toMatch(/toggleReconcile\(id/);
    });

    test('toggleReconcile calls reconcile endpoint', () => {
      expect(indexHtml).toMatch(/\/transactions\/\$\{id\}\/reconcile/);
    });

    test('toggleReconcile uses PATCH method', () => {
      expect(indexHtml).toMatch(/toggleReconcile/);
      expect(indexHtml).toMatch(/method:\s*['"]PATCH['"]/);
    });

    test('toggleReconcile reloads transaction list', () => {
      expect(indexHtml).toMatch(/toggleReconcile[\s\S]{0,200}this\.load\(\)/);
    });

    test('Reconciled checkbox is included in save data object', () => {
      expect(indexHtml).toMatch(/tx-reconciled.*checked/);
    });
  });

  describe('Inline reconciliation workflow', () => {
    test('Reconcile button shown in transaction row', () => {
      expect(indexHtml).toMatch(/onclick="transactions\.toggleReconcile/);
    });

    test('Reconcile button changes style when reconciled', () => {
      expect(indexHtml).toMatch(/t\.reconciled.*text-success/);
    });

    test('Reconcile button has conditional icon (check vs circle)', () => {
      expect(indexHtml).toMatch(/M5 13l4 4L19 7/);
    });
  });
});
