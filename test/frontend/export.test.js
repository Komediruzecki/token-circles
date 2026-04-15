/**
 * Tests for data export feature
 */
const fs = require('fs');
const path = require('path');

describe('Data Export', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('Export UI in settings page', () => {
    test('export buttons exist in settings page', () => {
      expect(htmlContent).toContain('onclick="exportData(\'transactions\')"');
      expect(htmlContent).toContain('onclick="exportData(\'categories\')"');
      expect(htmlContent).toContain('onclick="exportData(\'accounts\')"');
      expect(htmlContent).toContain('onclick="exportData(\'budgets\')"');
      expect(htmlContent).toContain('onclick="exportData(\'loans\')"');
      expect(htmlContent).toContain('onclick="exportData(\'recurring\')"');
    });

    test('export format selector exists', () => {
      expect(htmlContent).toContain('id="export-format"');
      expect(htmlContent).toContain('option value="csv"');
      expect(htmlContent).toContain('option value="json"');
    });

    test('Data Export section title exists', () => {
      expect(htmlContent).toContain('Data Export');
    });
  });

  describe('Export function', () => {
    test('exportData function uses window.open for download', () => {
      expect(htmlContent).toContain('function exportData(type)');
      expect(htmlContent).toContain('window.open(`/api/export/${type}');
    });

    test('exportData reads format from selector', () => {
      expect(htmlContent).toContain("getElementById('export-format').value");
    });
  });
});