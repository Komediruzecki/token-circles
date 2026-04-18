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
      expect(combinedContent).toContain('data-action="exportData" data-arg="transactions"');
      expect(combinedContent).toContain('data-action="exportData" data-arg="categories"');
      expect(combinedContent).toContain('data-action="exportData" data-arg="accounts"');
      expect(combinedContent).toContain('data-action="exportData" data-arg="budgets"');
      expect(combinedContent).toContain('data-action="exportData" data-arg="loans"');
      expect(combinedContent).toContain('data-action="exportData" data-arg="recurring"');
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