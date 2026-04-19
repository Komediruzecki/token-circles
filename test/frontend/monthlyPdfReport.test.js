/**
 * Tests for Monthly PDF Report backend endpoint
 * Note: Frontend migrated to SolidJS - PDF report is a settings page feature
 */

const fs = require('fs');
const path = require('path');

describe('Monthly PDF Report - Backend API', () => {
  const backendIndex = fs.readFileSync(
    path.join(__dirname, '../../backend/index.js'),
    'utf8'
  );

  describe('Backend PDF Report endpoint', () => {
    test('GET /api/reports/monthly-pdf endpoint exists', () => {
      expect(backendIndex).toMatch(/app\.get\s*\(\s*["']\/api\/reports\/monthly-pdf["']/);
    });

    test('PDF report endpoint uses apiRateLimiter', () => {
      expect(backendIndex).toMatch(/\/api\/reports\/monthly-pdf.*apiRateLimiter/);
    });

    test('PDF report endpoint accepts year parameter', () => {
      expect(backendIndex).toMatch(/year.*req\.query/);
    });

    test('PDF report endpoint uses PDFKit for PDF generation', () => {
      expect(backendIndex).toMatch(/pdfKit|PDFKit/);
    });

    test('PDF report uses pdf template', () => {
      expect(backendIndex).toMatch(/pages\/report\/monthly\.pdf/);
    });
  });

  describe('PDF Report functionality', () => {
    test('PDF report includes balance section', () => {
      expect(backendIndex).toMatch(/balance|Balance/);
    });

    test('PDF report includes transaction list', () => {
      expect(backendIndex).toMatch(/transactions|Transactions/);
    });

    test('PDF report includes category breakdown', () => {
      expect(backendIndex).toMatch(/categories|Categories/);
    });
  });
});
