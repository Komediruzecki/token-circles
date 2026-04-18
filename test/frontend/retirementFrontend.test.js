/**
 * Frontend unit tests for retirement calculator
 * These tests verify the JavaScript logic that runs in the browser.
 */
const { readFrontendContent } = require('./testUtils');

describe('Retirement Calculator Frontend', () => {
  let combinedContent;

  beforeAll(() => {
    const content = readFrontendContent();
    combinedContent = content.combinedContent;
  });

  describe('retirement-layout grid layout', () => {
    test('retirement-layout grid container exists', () => {
      expect(combinedContent).toContain('class="retirement-layout"');
    });

    test('res-scenarios div exists with FIRE Scenarios header', () => {
      expect(combinedContent).toContain('id="res-scenarios"');
      expect(combinedContent).toContain('FIRE Scenarios');
    });

    test('ret-chart canvas is in its own card spanning full width', () => {
      expect(combinedContent).toContain('class="card retirement-chart-card"');
      expect(combinedContent).toContain('id="ret-chart"');
    });

    test('retirement-right contains FIRE Summary card', () => {
      expect(combinedContent).toContain('FIRE Summary');
    });

    test('all FIRE result elements exist', () => {
      expect(combinedContent).toContain('id="res-fire-age"');
      expect(combinedContent).toContain('id="res-fire-number"');
      expect(combinedContent).toContain('id="res-months-to-fire"');
      expect(combinedContent).toContain('id="res-current-nw"');
      expect(combinedContent).toContain('id="res-traditional-age"');
      expect(combinedContent).toContain('id="res-savings-at-fire"');
    });

    test('ret-chart canvas exists', () => {
      expect(combinedContent).toContain('id="ret-chart"');
    });
  });

  describe('renderResults defensive checks', () => {
    test('renders results div is checked for existence before use', () => {
      // The renderResults function should check for retirement-results element
      const renderResultsMatch = combinedContent.match(/renderResults\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}\s*;?\s*$/m);
      expect(renderResultsMatch).toBeTruthy();

      // Should have null check: if (!resultsEl)
      expect(combinedContent).toContain('if (!resultsEl)');
    });

    test('scenariosDiv is checked for existence before setting innerHTML', () => {
      // The scenariosDiv should be checked before innerHTML
      const lines = combinedContent.split('\n');
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
      expect(combinedContent).toMatch(/retChart\s*&&\s*\(\s*retChart\.parentElement\.innerHTML/);
    });
  });

  describe('retirement form elements', () => {
    test('all form inputs exist with correct ids', () => {
      expect(combinedContent).toContain('id="ret-age"');
      expect(combinedContent).toContain('id="ret-age-goal"');
      expect(combinedContent).toContain('id="ret-savings"');
      expect(combinedContent).toContain('id="ret-contrib"');
      expect(combinedContent).toContain('id="ret-expenses"');
      expect(combinedContent).toContain('id="ret-return"');
      expect(combinedContent).toContain('id="ret-country"');
    });

    test('retirement form has oninput handler for auto-recalculation', () => {
      expect(combinedContent).toContain('oninput="retirement.scheduleUpdate()"');
    });

    test('calculate button removed (auto-calculate enabled)', () => {
      // The button should NOT exist since we auto-calculate now
      const lines = combinedContent.split('\n');
      const formLine = lines.findIndex(l => l.includes('id="retirement-form"'));
      expect(formLine).toBeGreaterThan(-1);
      // Check next 30 lines after form don't contain onclick="retirement.calculate"
      const afterForm = lines.slice(formLine, formLine + 30).join('\n');
      expect(afterForm).not.toContain('onclick="retirement.calculate()"');
    });
  });

  describe('expensesAtRetirement input', () => {
    test('ret-expenses-retire input exists for direct retirement expenses', () => {
      expect(combinedContent).toContain('id="ret-expenses-retire"');
    });

    test('country selector has new options (USA, Europe, Switzerland, Croatia, Japan)', () => {
      expect(combinedContent).toContain('<option value="usa">USA</option>');
      expect(combinedContent).toContain('<option value="europe">Europe</option>');
      expect(combinedContent).toContain('<option value="switzerland">Switzerland</option>');
      expect(combinedContent).toContain('<option value="croatia">Croatia</option>');
      expect(combinedContent).toContain('<option value="japan">Japan</option>');
    });

    test('country selector has data-action for enable/disable logic', () => {
      expect(combinedContent).toContain('data-action="retirement.handleCountryChange"');
    });

    test('handleCountryChange method exists in retirement object', () => {
      // Search for handleCountryChange function definition
      const lines = combinedContent.split('\n');
      let found = false;
      for (const line of lines) {
        if (line.includes('handleCountryChange()')) { found = true; break; }
      }
      expect(found).toBe(true);
    });

    test('calculate function sends expensesAtRetirement parameter', () => {
      // The payload should include expensesAtRetirement
      const lines = combinedContent.split('\n');
      let found = false;
      for (const line of lines) {
        if (line.includes('expensesAtRetirement:')) { found = true; break; }
      }
      expect(found).toBe(true);
    });

    test('calculate function disables expenses input when country selected', () => {
      // When country is selected, expensesAtRetirement should be null
      // Check that the ternary appears in the calculate function
      expect(combinedContent).toMatch(/expensesAtRetirement\s*=\s*country\s*\?\s*null/);
    });
  });
});
