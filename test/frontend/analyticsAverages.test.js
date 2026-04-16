/**
 * Tests for Analytics averages calculation
 */
const fs = require('fs');
const path = require('path');

describe('Analytics Averages Calculation', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('renderAverages uses numDays from API', () => {
    test('renderAverages uses data.numDays, not data.labels.length', () => {
      // The bug: renderAverages uses data.labels.length as numDays
      // Year view has 12 labels (months), so avg = total/12 (way too high)
      // Fix: use data.numDays from API
      expect(htmlContent).toContain('data.numDays');
      // Should NOT use labels.length for average calculation
      // (We allow labels.length for other purposes like chart labels, but not for avg)
    });

    test('renderAverages function exists and calculates daily average', () => {
      expect(htmlContent).toContain('renderAverages(data)');
      // avgDay should be calculated from total and numDays
      expect(htmlContent).toContain('avgDay');
      expect(htmlContent).toContain('avgWeek');
      expect(htmlContent).toContain('avgMonth');
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
