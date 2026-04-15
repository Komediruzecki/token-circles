/**
 * Frontend unit tests for retirement calculator
 * These tests verify the JavaScript logic that runs in the browser.
 */
const fs = require('fs');
const path = require('path');

describe('Retirement Calculator Frontend', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('retirement-results elements', () => {
    test('retirement-results div exists with correct id', () => {
      expect(htmlContent).toContain('id="retirement-results"');
    });

    test('ret-scenarios div exists inside retirement-results', () => {
      // Verify ret-scenarios div exists by checking line 743 content
      const lines = htmlContent.split('\n');
      const line743 = lines[742];
      expect(line743).toContain('ret-scenarios');
      // Check it's a div element
      expect(line743.trim().startsWith('<div id="ret-scenarios"')).toBe(true);
      // Verify it's nested inside retirement-results by checking the parent div (line 742)
      const line742 = lines[741];
      expect(line742).toContain('retirement-results');
    });

    test('retirement-placeholder div exists', () => {
      expect(htmlContent).toContain('id="retirement-placeholder"');
    });

    test('all FIRE result elements exist', () => {
      expect(htmlContent).toContain('id="res-fire-age"');
      expect(htmlContent).toContain('id="res-fire-number"');
      expect(htmlContent).toContain('id="res-months-to-fire"');
      expect(htmlContent).toContain('id="res-current-nw"');
      expect(htmlContent).toContain('id="res-traditional-age"');
      expect(htmlContent).toContain('id="res-savings-at-fire"');
    });

    test('ret-chart canvas exists', () => {
      expect(htmlContent).toContain('id="ret-chart"');
    });
  });

  describe('renderResults defensive checks', () => {
    test('renders results div is checked for existence before use', () => {
      // The renderResults function should check for retirement-results element
      const renderResultsMatch = htmlContent.match(/renderResults\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}\s*;?\s*$/m);
      expect(renderResultsMatch).toBeTruthy();

      // Should have null check: if (!resultsEl || !placeholderEl)
      expect(htmlContent).toContain('if (!resultsEl || !placeholderEl)');
    });

    test('scenariosDiv is checked for existence before setting innerHTML', () => {
      // The scenariosDiv should be checked before innerHTML
      const lines = htmlContent.split('\n');
      let foundNullCheck = false;
      let foundInnerHTMLAfter = false;
      let inRenderResults = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('renderResults')) inRenderResults = true;

        if (inRenderResults) {
          if (line.includes('if (scenariosDiv)')) foundNullCheck = true;
          if (foundNullCheck && line.includes('scenariosDiv.innerHTML')) foundInnerHTMLAfter = true;
          if (line.includes('retChart &&') || line.includes('if (timeline.length === 0 || !retChart)')) break;
        }
      }

      expect(foundNullCheck).toBe(true);
      expect(foundInnerHTMLAfter).toBe(true);
    });

    test('retChart is checked before accessing parentElement.innerHTML', () => {
      // The retChart element should be checked before accessing parentElement
      expect(htmlContent).toContain('retChart && (retChart.parentElement.innerHTML');
    });
  });

  describe('retirement form elements', () => {
    test('all form inputs exist with correct ids', () => {
      expect(htmlContent).toContain('id="ret-age"');
      expect(htmlContent).toContain('id="ret-age-goal"');
      expect(htmlContent).toContain('id="ret-savings"');
      expect(htmlContent).toContain('id="ret-contrib"');
      expect(htmlContent).toContain('id="ret-expenses"');
      expect(htmlContent).toContain('id="ret-return"');
      expect(htmlContent).toContain('id="ret-country"');
    });

    test('calculate button exists', () => {
      expect(htmlContent).toContain('onclick="retirement.calculate()"');
    });
  });
});
