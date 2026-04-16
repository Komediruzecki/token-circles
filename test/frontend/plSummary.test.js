/**
 * Tests for P&L Summary UI
 */
const fs = require('fs');
const path = require('path');

describe('P&L Summary UI', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('Year-End P&L Summary section in Settings', () => {
    test('P&L Summary section exists in Settings', () => {
      expect(htmlContent).toContain('Year-End P&L Summary');
      expect(htmlContent).toContain('pl-summary-year');
    });

    test('P&L PDF button exists', () => {
      expect(htmlContent).toContain('onclick="generatePlSummaryPDF()"');
      expect(htmlContent).toContain('Download P&L PDF');
    });

    test('generatePlSummaryPDF function exists', () => {
      expect(htmlContent).toContain('function generatePlSummaryPDF()');
    });

    test('generatePlSummaryPDF opens correct URL', () => {
      expect(htmlContent).toContain('/api/reports/pl-summary-pdf?year=');
      expect(htmlContent).toContain('pl-summary-year');
    });

    test('populatePlSummaryYears function exists', () => {
      expect(htmlContent).toContain('function populatePlSummaryYears()');
    });

    test('pl-summary-year selector is populated on settings load', () => {
      expect(htmlContent).toContain('populatePlSummaryYears()');
    });
  });

  describe('Backend P&L endpoints', () => {
    test('/api/reports/pl-summary endpoint exists in backend', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('/api/reports/pl-summary');
    });

    test('/api/reports/pl-summary-pdf endpoint exists in backend', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('/api/reports/pl-summary-pdf');
    });

    test('P&L PDF includes net savings in summary box', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('Net Savings');
    });

    test('P&L PDF includes savings rate', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('savings rate');
    });
  });
});
