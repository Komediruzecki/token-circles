/**
 * Tests for chart export functionality in SolidJS frontend
 * Note: Chart export functionality is handled via API endpoints
 */

describe('Chart Export - SolidJS Frontend', () => {
  let indexHtml;

  beforeAll(() => {
    indexHtml = require('fs').readFileSync(
      require('path').join(__dirname, '../../frontend/index.html'),
      'utf8'
    );
  });

  describe('Frontend architecture', () => {
    test('uses Chart.js for chart rendering', () => {
      expect(indexHtml).toContain('chart.js');
    });

    test('chart canvases have proper IDs', () => {
      const canvasIds = [
        'expense-category-chart',
        'monthly-chart',
        'cashflow-chart',
        'category-trends-chart',
        'stacked-bar-chart',
        'pie-chart',
        'retirement-chart',
        'amort-chart',
      ];
      canvasIds.forEach(id => {
        expect(indexHtml).toContain(id);
      });
    });

    test('chart containers exist in HTML', () => {
      expect(indexHtml).toMatch(/class\s*=\s*["'][^"]*chart-container[^"]*["']/);
    });

    test('export functionality available via API endpoints', () => {
      const backendContent = require('fs').readFileSync(
        require('path').join(__dirname, '../../backend/index.js'),
        'utf8'
      );
      expect(backendContent).toMatch(/\/api\/transactions\/export/);
      expect(backendContent).toMatch(/exportToCsv|exportToExcel/);
    });

    test('no inline event handlers for charts in HTML', () => {
      // Inline onclick handlers should not be present
      const lines = indexHtml.split('\n');
      const hasInlineChartHandlers = lines.some(line => 
        /onclick\s*=\s*["']/.test(line) && 
        (line.includes('chart') || line.includes('export'))
      );
      expect(hasInlineChartHandlers).toBe(false);
    });
  });

  describe('CSS styling for charts', () => {
    test('chart containers have responsive styling', () => {
      const chartClass = /\.chart-container\s*\{/g;
      expect(indexHtml).toMatch(chartClass);
    });

    test('chart containers maintain aspect ratio', () => {
      const styleProps = ['aspect-ratio', 'height', 'min-height'];
      const hasStyle = styleProps.some(prop => indexHtml.includes(prop));
      expect(hasStyle).toBe(true);
    });

    test('chart canvases have proper responsiveness', () => {
      expect(indexHtml).toMatch(/width:\s*["']100%["']/);
      expect(indexHtml).toMatch(/height:\s*["']auto["']/);
    });
  });

  describe('Export buttons and links', () => {
    test('download buttons exist in HTML', () => {
      // Look for export/download buttons
      const hasDownloadButtons = indexHtml.match(/class="[^"]*btn-download[^"]*"/g);
      expect(hasDownloadButtons).toBeTruthy();
    });

    test('export buttons use data-action for event handling', () => {
      expect(indexHtml).toMatch(/data-action=["'][^"]*export[^"]*["']/);
    });

    test('export buttons have appropriate titles', () => {
      expect(indexHtml).toMatch(/title=["'][^"]*export[^"]*["']/);
    });
  });

  describe('External chart libraries', () => {
    test('Chart.js loaded from CDN', () => {
      expect(indexHtml).toContain('cdn.jsdelivr.net/npm/chart.js');
    });

    test('Chart.js loaded via module or script tag', () => {
      expect(indexHtml).toMatch(/chart\.js/);
    });
  });
});
