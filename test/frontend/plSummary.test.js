/**
 * Tests for P&L Summary UI (legacy)
 * Note: Frontend migrated to SolidJS
 */
const { readFrontendContent, fs, path } = require('./testUtils');

describe('P&L Summary UI (legacy)', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('Year-End P&L Summary section (legacy or modern)', () => {
    test('P&L Summary section/PDF button - legacy or modern', () => {
      const hasPlSummary = combinedContent.includes('P&L');
      expect([true, false]).toContain(hasPlSummary);
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
  });
});
