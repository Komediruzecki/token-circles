/**
 * Tests for Monthly PDF Report UI
 */
const fs = require('fs');
const path = require('path');

describe('Monthly PDF Report UI', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('PDF Report section in Settings page', () => {
    test('Monthly PDF Report section exists in Settings', () => {
      expect(htmlContent).toContain('Monthly PDF Report');
      expect(htmlContent).toContain('pdf-report-month');
      expect(htmlContent).toContain('pdf-report-year');
    });

    test('generateMonthlyPDF function exists', () => {
      expect(htmlContent).toContain('function generateMonthlyPDF()');
    });

    test('generateMonthlyPDF opens correct URL', () => {
      expect(htmlContent).toContain('/api/reports/monthly-pdf?year=');
      expect(htmlContent).toContain('pdf-report-year');
      expect(htmlContent).toContain('pdf-report-month');
    });

    test('populatePdfReportYears function exists', () => {
      expect(htmlContent).toContain('function populatePdfReportYears()');
    });

    test('PDF report button exists', () => {
      expect(htmlContent).toContain('onclick="generateMonthlyPDF()"');
    });

    test('PDF endpoint exists in backend', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('/api/reports/monthly-pdf');
    });
  });
});
