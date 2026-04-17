/**
 * Tests for loading states feature
 */
const { readFrontendContent } = require('./testUtils');

describe('Loading states', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('CSS spinner and loading classes', () => {
    test('loading-spinner CSS class exists', () => {
      expect(combinedContent).toContain('loading-spinner');
    });

    test('spin keyframe animation is defined', () => {
      expect(combinedContent).toContain('@keyframes spin');
    });

    test('btn.loading class exists for disabled buttons', () => {
      expect(combinedContent).toContain('.btn.loading');
    });

    test('table-loading class exists for table opacity', () => {
      expect(combinedContent).toContain('.table-loading');
    });
  });

  describe('Transaction save button has spinner', () => {
    test('tx-save-btn has id for loading state manipulation', () => {
      expect(combinedContent).toContain('id="tx-save-btn"');
    });

    test('transactions.save() uses tx-save-btn with loading state', () => {
      // Find the transaction save function that uses tx-save-btn
      const idx = combinedContent.indexOf("const btn = document.getElementById('tx-save-btn')");
      expect(idx).toBeGreaterThan(-1);
      // Check the surrounding context for try/finally - need larger window
      const context = combinedContent.substring(idx, idx + 2500);
      expect(context).toContain('finally');
      expect(context).toContain('classList.add');
      expect(context).toContain('classList.remove');
    });
  });

  describe('Category save button has spinner', () => {
    test('cat-save-btn has id for loading state manipulation', () => {
      expect(combinedContent).toContain('id="cat-save-btn"');
    });

    test('categories.save() uses cat-save-btn with loading state', () => {
      const idx = combinedContent.indexOf("const btn = document.getElementById('cat-save-btn')");
      expect(idx).toBeGreaterThan(-1);
      const context = combinedContent.substring(idx, idx + 1500);
      expect(context).toContain('finally');
      expect(context).toContain('classList.add');
    });
  });

  describe('Loan save button has spinner', () => {
    test('loan-save-btn has id for loading state manipulation', () => {
      expect(combinedContent).toContain('id="loan-save-btn"');
    });

    test('loans.saveLoan() uses loan-save-btn with loading state', () => {
      const idx = combinedContent.indexOf("const btn = document.getElementById('loan-save-btn')");
      expect(idx).toBeGreaterThan(-1);
      const context = combinedContent.substring(idx, idx + 2000);
      expect(context).toContain('finally');
      expect(context).toContain('classList.add');
    });
  });

  describe('Import file loading indicator', () => {
    test('import-dropzone has spinner element', () => {
      expect(combinedContent).toContain('id="import-spinner"');
    });

    test('dataImport.handleFile shows/hides spinner', () => {
      expect(combinedContent).toContain("document.getElementById('import-spinner')");
      expect(combinedContent).toContain('spinner.style.display');
    });
  });

  describe('Transaction table loading state', () => {
    test('transactions.load adds table-loading class', () => {
      expect(combinedContent).toContain("table.classList.add('table-loading')");
    });

    test('transactions.render removes table-loading class', () => {
      expect(combinedContent).toContain("tbody.classList.remove('table-loading')");
    });
  });
});