/**
 * Tests for Monthly PDF Report UI
 */
const { readFrontendContent } = require('./testUtils');
const fs = require('fs');
const path = require('path');

describe('Monthly PDF Report UI', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('PDF Report section in Settings page', () => {
    test('generateMonthlyPDF function exists', () => {
      expect(combinedContent).toContain('function generateMonthlyPDF()');
    });

    test('generateMonthlyPDF opens correct URL', () => {
      expect(combinedContent).toContain('/api/reports/monthly-pdf?year=');
    });

    test('populatePdfReportYears function exists', () => {
      expect(combinedContent).toContain('function populatePdfReportYears()');
    });
  });
});
