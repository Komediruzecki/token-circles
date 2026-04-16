/**
 * Tests for Annual Financial Report PDF UI
 */
const fs = require('fs');
const path = require('path');

describe('Annual Financial Report UI', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('Annual Financial Report section in Settings', () => {
    test('Annual Financial Report section exists in Settings', () => {
      expect(htmlContent).toContain('Annual Financial Report');
      expect(htmlContent).toContain('annual-report-year');
    });

    test('Annual Report button exists', () => {
      expect(htmlContent).toContain('onclick="generateAnnualPDF()"');
      expect(htmlContent).toContain('Download Annual PDF');
    });

    test('generateAnnualPDF function exists', () => {
      expect(htmlContent).toContain('function generateAnnualPDF()');
    });

    test('populateAnnualReportYears function exists', () => {
      expect(htmlContent).toContain('function populateAnnualReportYears()');
    });

    test('annual-report-year selector is populated on settings load', () => {
      expect(htmlContent).toContain('populateAnnualReportYears()');
    });
  });

  describe('Backend Annual PDF endpoint', () => {
    test('GET /api/reports/annual-pdf endpoint exists in backend', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('/api/reports/annual-pdf');
    });

    test('generateAnnualPDF uses GET method', () => {
      expect(htmlContent).toContain('fetch(`/api/reports/annual-pdf?year=');
    });

    test('generateAnnualPDF downloads blob as file', () => {
      expect(htmlContent).toContain('URL.createObjectURL(blob)');
      expect(htmlContent).toContain('download = ');
      expect(htmlContent).toContain('annual-report-${year}.pdf');
    });

    test('export.html exists as dedicated chart rendering page', () => {
      const exportPath = path.join(__dirname, '../../frontend/export.html');
      expect(fs.existsSync(exportPath)).toBe(true);
    });
  });
});
