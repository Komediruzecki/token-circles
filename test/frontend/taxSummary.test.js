/**
 * Tests for Tax Summary UI
 */
const fs = require('fs');
const path = require('path');

describe('Tax Summary UI', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('Year-End Tax Summary section in Settings', () => {
    test('Tax Summary section exists in Settings', () => {
      expect(htmlContent).toContain('Year-End Tax Summary');
      expect(htmlContent).toContain('tax-summary-year');
    });

    test('Tax Summary PDF button exists', () => {
      expect(htmlContent).toContain('onclick="generateTaxSummaryPDF()"');
      expect(htmlContent).toContain('Download Tax PDF');
    });

    test('generateTaxSummaryPDF function exists', () => {
      expect(htmlContent).toContain('function generateTaxSummaryPDF()');
    });

    test('generateTaxSummaryPDF opens correct URL', () => {
      expect(htmlContent).toContain('/api/reports/tax-summary-pdf?year=');
      expect(htmlContent).toContain('tax-summary-year');
    });

    test('populateTaxSummaryYears function exists', () => {
      expect(htmlContent).toContain('function populateTaxSummaryYears()');
    });

    test('tax-summary-year selector is populated from analytics', () => {
      expect(htmlContent).toContain('populateTaxSummaryYears()');
    });
  });

  describe('Category tax-deductible toggle', () => {
    test('tax-deductible checkbox exists in category modal', () => {
      expect(htmlContent).toContain('id="cat-tax"');
    });

    test('tax_deductible is sent in POST /api/categories', () => {
      expect(htmlContent).toContain("tax_deductible: document.getElementById('cat-tax').checked");
    });

    test('tax_deductible is sent in PUT /api/categories', () => {
      // PUT uses the same data object, just different method
      expect(htmlContent).toContain("tax_deductible: document.getElementById('cat-tax').checked");
    });

    test('openModal populates tax checkbox for existing category', () => {
      expect(htmlContent).toContain("document.getElementById('cat-tax').checked = !!c.tax_deductible");
    });

    test('Tax badge is shown on categories with tax_deductible', () => {
      expect(htmlContent).toContain('c.tax_deductible');
      expect(htmlContent).toContain('Tax</span>');
    });

    test('Tax badge label uses green color', () => {
      expect(htmlContent).toContain('#16a34a');
      expect(htmlContent).toContain('#dcfce7');
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
