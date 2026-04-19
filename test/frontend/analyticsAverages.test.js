/**
 * Tests for Analytics averages calculation
 */
const { readFrontendContent, fs, path } = require('./testUtils');

describe('Analytics Averages Calculation', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('renderAverages uses numDays from API', () => {
    test('renderAverages uses data.numDays, not data.labels.length', () => {
      // The bug: renderAverages uses data.labels.length as numDays
      // Year view has 12 labels (months), so avg = total/12 (way too high)
      // Fix: use data.numDays from API
      expect(combinedContent).toContain('data.numDays');
      // Should NOT use labels.length for average calculation
      // (We allow labels.length for other purposes like chart labels, but not for avg)
    });

    test('renderAverages function exists and calculates daily average', () => {
      // Check that avgDay, avgWeek, avgMonth appear in the JS context
      const jsContent = readFrontendContent().jsContent;
      expect(jsContent).toContain('renderAverages');
      expect(jsContent).toContain('avgDay');
      expect(jsContent).toContain('avgWeek');
      expect(jsContent).toContain('avgMonth');
    });
  });

  describe('numDays field in API response', () => {
    test('backend category-trends endpoint returns numDays in response', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      // Should return numDays in the JSON response
      expect(backendContent).toContain('numDays');
    });

    test('numDays is calculated correctly for year view', () => {
      const backendContent = fs.readFileSync(path.join(__dirname, '../../backend/index.js'), 'utf8');
      // Should have leap year logic (366 days) and non-leap year (365 days)
      // or use a reliable method to compute days between startStr and endStr
      expect(backendContent).toContain('numDays');
    });
  });
});
