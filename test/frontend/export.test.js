/**
 * Tests for data export feature
 */
const { readFrontendContent } = require('./testUtils');

describe('Data Export', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('Export UI in settings page', () => {
    test('export buttons exist in settings page', () => {
      expect(combinedContent).toContain('onclick="exportData(\'transactions\')"');
      expect(combinedContent).toContain('onclick="exportData(\'categories\')"');
      expect(combinedContent).toContain('onclick="exportData(\'accounts\')"');
      expect(combinedContent).toContain('onclick="exportData(\'budgets\')"');
      expect(combinedContent).toContain('onclick="exportData(\'loans\')"');
      expect(combinedContent).toContain('onclick="exportData(\'recurring\')"');
    });

    test('export format selector exists', () => {
      expect(combinedContent).toContain('id="export-format"');
      expect(combinedContent).toContain('option value="csv"');
      expect(combinedContent).toContain('option value="json"');
    });

    test('Data Export section title exists', () => {
      expect(combinedContent).toContain('Data Export');
    });
  });

  describe('Export function', () => {
    test('exportData function uses window.open for download', () => {
      expect(combinedContent).toContain('function exportData(type)');
      expect(combinedContent).toContain('window.open(`/api/export/${type}');
    });

    test('exportData reads format from selector', () => {
      expect(combinedContent).toContain("getElementById('export-format').value");
    });
  });
});