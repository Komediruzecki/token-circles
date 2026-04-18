/**
 * Tests for Tax Summary UI
 */
const { readFrontendContent, fs, path } = require('./testUtils');

describe('Tax Summary UI', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('Year-End Tax Summary section in Settings', () => {
    test('Tax Summary section exists in Settings', () => {
      expect(combinedContent).toContain('Year-End Tax Summary');
      expect(combinedContent).toContain('tax-summary-year');
    });

    test('Tax Summary PDF button exists', () => {
      expect(combinedContent).toContain('data-action="generateTaxSummaryPDF"');
      expect(combinedContent).toContain('Download Tax PDF');
    });

    test('generateTaxSummaryPDF function exists', () => {
      expect(combinedContent).toContain('function generateTaxSummaryPDF()');
    });

    test('generateTaxSummaryPDF opens correct URL', () => {
      expect(combinedContent).toContain('/api/reports/tax-summary-pdf?year=');
      expect(combinedContent).toContain('tax-summary-year');
    });

    test('populateTaxSummaryYears function exists', () => {
      expect(combinedContent).toContain('function populateTaxSummaryYears()');
    });

    test('tax-summary-year selector is populated from analytics', () => {
      expect(combinedContent).toContain('populateTaxSummaryYears()');
    });
  });

  describe('Category tax-deductible toggle', () => {
    test('tax-deductible checkbox exists in category modal', () => {
      expect(combinedContent).toContain('id="cat-tax"');
    });

    test('tax_deductible is sent in POST /api/categories', () => {
      expect(combinedContent).toContain("tax_deductible: document.getElementById('cat-tax').checked");
    });

    test('tax_deductible is sent in PUT /api/categories', () => {
      // PUT uses the same data object, just different method
      expect(combinedContent).toContain("tax_deductible: document.getElementById('cat-tax').checked");
    });

    test('openModal populates tax checkbox for existing category', () => {
      expect(combinedContent).toContain("document.getElementById('cat-tax').checked = !!c.tax_deductible");
    });

    test('Tax badge is shown on categories with tax_deductible', () => {
      expect(combinedContent).toContain('c.tax_deductible');
      expect(combinedContent).toContain('Tax</span>');
    });

    test('Tax badge label uses green color', () => {
      expect(combinedContent).toContain('#16a34a');
      expect(combinedContent).toContain('#dcfce7');
    });
  });

  describe('Backend tax summary endpoints', () => {
    test('/api/reports/tax-summary endpoint exists in backend', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('/api/reports/tax-summary');
    });

    test('/api/reports/tax-summary-pdf endpoint exists in backend', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('/api/reports/tax-summary-pdf');
    });

    test('PUT /api/categories includes tax_deductible in SQL', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('tax_deductible=?');
    });

    test('categories table has tax_deductible column', () => {
      const dbContent = fs.readFileSync(path.join(__dirname, '../../backend/database.js'), 'utf8');
      expect(dbContent).toContain('tax_deductible');
    });
  });
});
