/**
 * Tests for Annual Financial Report PDF UI
 */
const { readFrontendContent, fs, path } = require('./testUtils');

describe('Annual Financial Report UI', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('Annual Financial Report section in Settings', () => {
    test('Annual Financial Report section exists in Settings', () => {
      expect(combinedContent).toContain('Annual Financial Report');
      expect(combinedContent).toContain('annual-report-year');
    });

    test('Annual Report button exists', () => {
      expect(combinedContent).toContain('data-action="generateAnnualPDF"');
      expect(combinedContent).toContain('Download Annual PDF');
    });

    test('generateAnnualPDF function exists', () => {
      expect(combinedContent).toContain('function generateAnnualPDF()');
    });

    test('populateAnnualReportYears function exists', () => {
      expect(combinedContent).toContain('function populateAnnualReportYears()');
    });

    test('annual-report-year selector is populated on settings load', () => {
      expect(combinedContent).toContain('populateAnnualReportYears()');
    });
  });

  describe('Backend Annual PDF endpoint', () => {
    test('GET /api/reports/annual-pdf endpoint exists in backend', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      expect(backendContent).toContain('/api/reports/annual-pdf');
    });

    test('generateAnnualPDF uses GET method', () => {
      expect(combinedContent).toContain('fetch(`/api/reports/annual-pdf?year=');
    });

    test('generateAnnualPDF downloads blob as file', () => {
      expect(combinedContent).toContain('URL.createObjectURL(blob)');
      expect(combinedContent).toContain('download = ');
      expect(combinedContent).toContain('annual-report-${year}.pdf');
    });

    test('export.html exists as dedicated chart rendering page', () => {
      const exportPath = path.join(__dirname, '../../frontend/export.html');
      expect(fs.existsSync(exportPath)).toBe(true);
    });
  });
});
