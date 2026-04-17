/**
 * Tests for delete confirmations feature
 */
const { readFrontendContent } = require('./testUtils');

describe('Delete confirmations', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('All delete operations have confirm dialogs', () => {
    test('recurring delete has confirm dialog', () => {
      expect(combinedContent).toContain("confirm('Delete this recurring transaction?')");
    });

    test('transaction delete has confirm dialog', () => {
      expect(combinedContent).toContain("confirm('Delete this transaction?')");
    });

    test('category delete has confirm dialog', () => {
      expect(combinedContent).toContain("confirm('Delete this category?')");
    });

    test('account delete has confirm dialog', () => {
      expect(combinedContent).toContain("confirm('Delete this account?')");
    });

    test('budget delete has confirm dialog', () => {
      expect(combinedContent).toContain("confirm('Delete this budget?')");
    });

    test('loan delete has confirm dialog', () => {
      expect(combinedContent).toContain("confirm('Delete this loan?')");
    });

    test('prepayment delete has confirm dialog', () => {
      expect(combinedContent).toContain("confirm('Delete this prepayment?')");
    });

    test('rate period delete has confirm dialog', () => {
      expect(combinedContent).toContain("confirm('Delete this rate period?')");
    });
  });

  describe('Bulk delete operations have extra confirmation', () => {
    test('delete all categories requires DELETE confirmation', () => {
      expect(combinedContent).toContain("prompt('Type DELETE to confirm:')");
      expect(combinedContent).toContain("typed !== 'DELETE'");
    });

    test('delete all transactions requires DELETE confirmation', () => {
      expect(combinedContent).toContain("confirm('Are you sure you want to delete ALL transactions?");
      expect(combinedContent).toContain("prompt('Type DELETE to confirm:')");
    });

    test('delete all profile data requires DELETE ALL confirmation', () => {
      expect(combinedContent).toMatch(/confirm\s*\(\s*['"]Are you sure you want to delete ALL data for this profile/);
      expect(combinedContent).toContain("prompt('Type DELETE ALL to confirm:')");
    });
  });

  describe('Import confirmation', () => {
    test('import execute has row count confirmation', () => {
      expect(combinedContent).toContain('confirm(`Import ${rowCount} transaction');
      expect(combinedContent).toContain("rowCount !== 1 ? 's' : ''");
    });

    test('import execute button has id for loading state', () => {
      expect(combinedContent).toContain('id="import-execute-btn"');
    });

    test('import execute shows loading spinner during import', () => {
      // Check that loading-spinner and finally appear after execute() in the import module
      const executeIdx = combinedContent.indexOf('async execute() {');
      const spinnerIdx = combinedContent.indexOf('loading-spinner', executeIdx);
      const finallyIdx = combinedContent.indexOf('finally', executeIdx);
      // Both should exist after execute()
      expect(spinnerIdx).toBeGreaterThan(executeIdx);
      expect(finallyIdx).toBeGreaterThan(executeIdx);
      // loading-spinner should appear before finally (in the try block, before finally)
      expect(spinnerIdx).toBeLessThan(finallyIdx);
    });
  });
});
