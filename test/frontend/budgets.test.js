/**
 * Tests for Budgets page template
 * Budgets page exists in the template system
 */
const { fs, path } = require('./testUtils');

describe('Budgets Page', () => {
  const content = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');

  describe('Component structure', () => {
    test('Budgets page has correct ID', () => {
      expect(content).toMatch(/id="page-budgets"/);
    });

    test('Budgets has page class', () => {
      expect(content).toMatch(/page/);
    });

    test('Budgets has page-enter animation class', () => {
      expect(content).toMatch(/page-enter/);
    });

    test('Page header exists', () => {
      expect(content).toMatch(/page-header/);
      expect(content).toMatch(/Budgets/);
    });

    test('Budgets has page-inner wrapper', () => {
      expect(content).toMatch(/page-inner/);
    });

    test('Page header has budget controls', () => {
      expect(content).toMatch(/page-header-actions/);
      expect(content).toMatch(/Add Budget/);
    });
  });

  describe('Budget page sections', () => {
    test('Has budget month selector', () => {
      expect(content).toMatch(/budget-month-select/);
    });

    test('Has budget period label', () => {
      expect(content).toMatch(/budget-period-label/);
    });

    test('Budget status card exists', () => {
      expect(content).toMatch(/Monthly Budget Status/);
    });

    test('Card header exists', () => {
      expect(content).toMatch(/card-header/);
    });

    test('Card title exists', () => {
      expect(content).toMatch(/card-title/);
    });
  });

  describe('Budget controls', () => {
    test('Copy Last Month button exists', () => {
      expect(content).toMatch(/Copy Last Month/);
      expect(content).toMatch(/budgets\.duplicateLastMonth/);
    });

    test('From Last Expenses button exists', () => {
      expect(content).toMatch(/From Last Expenses/);
      expect(content).toMatch(/budgets\.setFromExpenses/);
    });

    test('Add Budget button exists', () => {
      expect(content).toMatch(/Add Budget/);
      expect(content).toMatch(/budgets\.openModal/);
    });
  });

  describe('Navigation links', () => {
    test('Budgets link in sidebar', () => {
      expect(content).toMatch(/<span>Budgets<\/span>/);
    });

    test('Budgets link has data-page attribute', () => {
      expect(content).toMatch(/data-page="budgets"/);
    });
  });

  // Note: The Budgets.tsx component is in the source but uses a different build
  // This test covers the template-based implementation
});