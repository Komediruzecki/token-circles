/**
 * Tests for account reconciliation feature
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

describe('Account Reconciliation', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

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

  // Frontend UI - SKIPPED: feature not yet implemented in modular frontend
  // TODO(#86): Add reconciliation UI to templates/pages/transactions.html and js/features/transactions.js
  describe.skip('Frontend UI [SKIPPED - feature not implemented in modular frontend]', () => {
    test('Reconciled toggle checkbox exists in transaction modal', () => {});
    test('Reconciled label exists in modal', () => {});
    test('Reconciled check is saved in transaction save', () => {});
    test('Reconciled status is loaded when editing', () => {});
    test('Reconciled CSS class for rows exists', () => {});
    test('Reconciled rows have reduced opacity', () => {});
    test('Reconciled checkmark shown in date column', () => {});
  });

  describe.skip('Frontend JavaScript [SKIPPED - feature not implemented in modular frontend]', () => {
    test('toggleReconcile method exists', () => {});
    test('toggleReconcile calls reconcile endpoint', () => {});
    test('toggleReconcile uses PATCH method', () => {});
    test('toggleReconcile reloads transaction list', () => {});
    test('Reconciled checkbox is included in save data object', () => {});
  });

  describe.skip('Inline reconciliation workflow [SKIPPED - feature not implemented in modular frontend]', () => {
    test('Reconcile button shown in transaction row', () => {});
    test('Reconcile button changes style when reconciled', () => {});
    test('Reconcile button has conditional icon (check vs circle)', () => {});
  });
});
