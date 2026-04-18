/**
 * Tests for P&L Summary UI
 */
const { readFrontendContent, fs, path } = require('./testUtils');

describe('P&L Summary UI', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('Year-End P&L Summary section in Settings', () => {
    test('P&L Summary section exists in Settings', () => {
      expect(combinedContent).toContain('Year-End P&L Summary');
      expect(combinedContent).toContain('pl-summary-year');
    });

    test('P&L PDF button exists', () => {
      expect(combinedContent).toContain('data-action="generatePlSummaryPDF"');
      expect(combinedContent).toContain('Download P&L PDF');
    });

    test('generatePlSummaryPDF function exists', () => {
      expect(combinedContent).toContain('function generatePlSummaryPDF()');
    });

    test('generatePlSummaryPDF opens correct URL', () => {
      expect(combinedContent).toContain('/api/reports/pl-summary-pdf?year=');
      expect(combinedContent).toContain('pl-summary-year');
    });

    test('populatePlSummaryYears function exists', () => {
      expect(combinedContent).toContain('function populatePlSummaryYears()');
    });

    test('pl-summary-year selector is populated on settings load', () => {
      expect(combinedContent).toContain('populatePlSummaryYears()');
    });
  });

  describe('Backend P&L endpoints', () => {
    test('/api/reports/pl-summary endpoint exists in backend', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('/api/reports/pl-summary');
    });

    test('/api/reports/pl-summary-pdf endpoint exists in backend', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('/api/reports/pl-summary-pdf');
    });

    test('P&L PDF includes net savings in summary box', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('Net Savings');
    });

    test('P&L PDF includes savings rate', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('savings rate');
    });
  });
});
