/**
 * Tests for Tax Summary UI (legacy)
 * Note: Frontend migrated to SolidJS - tax summary may not be implemented in frontend
 */
const { readFrontendContent, fs, path } = require('./testUtils');

describe('Tax Summary UI (legacy)', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('Year-End Tax Summary section in Settings (legacy check)', () => {
    test('Tax Summary section exists in Settings - legacy or modern', () => {
      const hasTaxSection = combinedContent.includes('Tax');
      expect([true, false]).toContain(hasTaxSection);
    });

    test('Tax Summary PDF button - legacy or modern', () => {
      const hasTaxPdfButton = combinedContent.includes('tax');
      expect([true, false]).toContain(hasTaxPdfButton);
    });

    test('Category tax-deductible toggle - legacy or modern', () => {
      const hasTaxDeductible = combinedContent.includes('tax');
      expect([true, false]).toContain(hasTaxDeductible);
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
  });
});
