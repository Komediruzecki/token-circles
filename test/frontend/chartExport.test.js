/**
 * Tests for chartExport feature
 */

const { readFrontendContent, fs, path } = require('./testUtils');

const chartExportJs = fs.readFileSync(
  path.join(__dirname, '../../frontend/js/features/chartExport.js'),
  'utf8'
);

describe('chartExport module', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = readFrontendContent().htmlContent;
  });

  describe('chartExport.js file exists', () => {
    test('chartExport.js is included in index.html', () => {
      expect(htmlContent).toMatch(/<script\s+src\s*=\s*["']js\/features\/chartExport\.js(\?[^"']*)?["']\s*>/);
    });

    test('chartExport.js contains const chartExport', () => {
      expect(chartExportJs).toMatch(/const chartExport\s*=\s*\{/);
    });

    test('chartExport.js exports all required methods', () => {
      expect(chartExportJs).toMatch(/exportAsPng\s*\(/);
      expect(chartExportJs).toMatch(/exportAsSvg\s*\(/);
      expect(chartExportJs).toMatch(/showExportDialog\s*\(/);
      expect(chartExportJs).toMatch(/exportDashboardCategory\s*\(/);
      expect(chartExportJs).toMatch(/exportDashboardMonthly\s*\(/);
      expect(chartExportJs).toMatch(/exportDashboardCashflow\s*\(/);
      expect(chartExportJs).toMatch(/exportAnalyticsStacked\s*\(/);
      expect(chartExportJs).toMatch(/exportAnalyticsPie\s*\(/);
      expect(chartExportJs).toMatch(/exportLoanAmortization\s*\(/);
      expect(chartExportJs).toMatch(/exportRetirement\s*\(/);
      expect(chartExportJs).toMatch(/exportNetWorth\s*\(/);
    });
  });

  describe('exportAsPng method', () => {
    test('checks for canvas element before export', () => {
      expect(chartExportJs).toMatch(/if\s*\(\s*!\s*canvas\s*\)/);
    });

    test('creates download link', () => {
      expect(chartExportJs).toMatch(/document\.createElement\s*\(\s*['"]a['"]\s*\)/);
    });

    test('sets download attribute', () => {
      expect(chartExportJs).toMatch(/link\.download\s*=/);
    });

    test('uses toDataURL with image/png mime type', () => {
      expect(chartExportJs).toMatch(/toDataURL\s*\(\s*['"]image\/png['"]/);
    });

    test('calls click() on link to trigger download', () => {
      expect(chartExportJs).toMatch(/link\.click\s*\(\s*\)/);
    });

    test('has error handling with try/catch', () => {
      expect(chartExportJs).toMatch(/try\s*\{[\s\S]*?\} catch\s*\(\s*\w+\s*\)/);
    });

    test('shows toast notification on success', () => {
      expect(chartExportJs).toMatch(/toast\s*\(\s*['"]Chart exported as PNG['"]/);
    });

    test('shows toast notification on error', () => {
      expect(chartExportJs).toMatch(/toast\s*\(\s*['"]Failed to export chart as PNG['"]/);
    });

    test('has default filename parameter', () => {
      expect(chartExportJs).toMatch(/exportAsPng\s*\(\s*canvas\s*,\s*filename\s*=\s*['"]chart\.png['"]/);
    });
  });

  describe('exportAsSvg method', () => {
    test('checks for canvas element before export', () => {
      expect(chartExportJs).toMatch(/if\s*\(\s*!\s*canvas\s*\)/);
    });

    test('creates SVG blob', () => {
      expect(chartExportJs).toMatch(/new\s+Blob\s*\(\s*\[/);
    });

    test('sets SVG content type', () => {
      expect(chartExportJs).toMatch(/type\s*:\s*['"]image\/svg\+xml['"]/);
    });

    test('creates object URL for download', () => {
      expect(chartExportJs).toMatch(/URL\.createObjectURL\s*\(\s*blob\s*\)/);
    });

    test('revokes object URL after download', () => {
      expect(chartExportJs).toMatch(/URL\.revokeObjectURL\s*\(/);
    });

    test('shows toast notification on success', () => {
      expect(chartExportJs).toMatch(/toast\s*\(\s*['"]Chart exported as SVG['"]/);
    });

    test('has default filename parameter', () => {
      expect(chartExportJs).toMatch(/exportAsSvg\s*\(\s*canvas\s*,\s*filename\s*=\s*['"]chart\.svg['"]/);
    });
  });

  describe('showExportDialog method', () => {
    test('uses prompt for format selection', () => {
      expect(chartExportJs).toMatch(/prompt\s*\(\s*['"]Export format:\s*png or svg['"]\s*,\s*['"]png['"]/);
    });

    test('returns early if no format provided', () => {
      expect(chartExportJs).toMatch(/if\s*\(\s*!\s*format\s*\)\s*return/);
    });

    test('normalizes format to lowercase and trims', () => {
      expect(chartExportJs).toMatch(/\.toLowerCase\s*\(\s*\)\s*\.trim\s*\(\s*\)/);
    });

    test('handles png format', () => {
      expect(chartExportJs).toMatch(/normalizedFormat\s*===\s*['"]png['"]/);
    });

    test('handles svg format', () => {
      expect(chartExportJs).toMatch(/normalizedFormat\s*===\s*['"]svg['"]/);
    });

    test('calls exportAsPng for png format', () => {
      expect(chartExportJs).toMatch(/this\.exportAsPng\s*\(\s*canvas\s*,\s*`/);
    });

    test('calls exportAsSvg for svg format', () => {
      expect(chartExportJs).toMatch(/this\.exportAsSvg\s*\(\s*canvas\s*,\s*`/);
    });

    test('shows error for invalid format', () => {
      expect(chartExportJs).toMatch(/toast\s*\(\s*['"]Invalid format.*png or svg/i);
    });

    test('has default filename parameter', () => {
      expect(chartExportJs).toMatch(/showExportDialog\s*\(\s*canvas\s*,\s*defaultFilename\s*=\s*['"]chart['"]/);
    });
  });

  describe('dashboard export methods', () => {
    test('exportDashboardCategory gets chart-category canvas', () => {
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]chart-category['"]\s*\)/);
    });

    test('exportDashboardCategory uses dashboard-year input', () => {
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]dashboard-year['"]\s*\)/);
    });

    test('exportDashboardMonthly gets chart-monthly canvas', () => {
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]chart-monthly['"]\s*\)/);
    });

    test('exportDashboardCashflow gets chart-cashflow canvas', () => {
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]chart-cashflow['"]\s*\)/);
    });

    test('generates year-aware filenames', () => {
      expect(chartExportJs).toMatch(/spending-\$\{year\}/);
      expect(chartExportJs).toMatch(/monthly-\$\{year\}/);
      expect(chartExportJs).toMatch(/cashflow-\$\{year\}/);
    });
  });

  describe('analytics export methods', () => {
    test('exportAnalyticsStacked gets analytics-stacked-chart canvas', () => {
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]analytics-stacked-chart['"]\s*\)/);
    });

    test('exportAnalyticsStacked uses analytics-year and month filters', () => {
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]analytics-year['"]\s*\)/);
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]analytics-month-filter['"]\s*\)/);
    });

    test('exportAnalyticsPie gets analytics-pie-chart canvas', () => {
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]analytics-pie-chart['"]\s*\)/);
    });
  });

  describe('retirement export method', () => {
    test('exportRetirement gets ret-chart canvas', () => {
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]ret-chart['"]\s*\)/);
    });
  });

  describe('loan amortization export method', () => {
    test('exportLoanAmortization exists', () => {
      expect(chartExportJs).toMatch(/exportLoanAmortization\s*\(\s*\)\s*\{/);
    });

    test('exportLoanAmortization gets amort-chart canvas', () => {
      expect(chartExportJs).toMatch(/getElementById\s*\(\s*['"]amort-chart['"]\s*\)/);
    });
  });

  describe('export buttons in HTML', () => {
    test('dashboard category chart has export button', () => {
      expect(htmlContent).toMatch(/onclick\s*=\s*["']chartExport\.exportDashboardCategory\(\)["']/);
    });

    test('dashboard monthly chart has export button', () => {
      expect(htmlContent).toMatch(/onclick\s*=\s*["']chartExport\.exportDashboardMonthly\(\)["']/);
    });

    test('dashboard cashflow chart has export button', () => {
      expect(htmlContent).toMatch(/onclick\s*=\s*["']chartExport\.exportDashboardCashflow\(\)["']/);
    });

    test('analytics stacked chart has export button', () => {
      expect(htmlContent).toMatch(/onclick\s*=\s*["']chartExport\.exportAnalyticsStacked\(\)["']/);
    });

    test('analytics pie chart has export button', () => {
      expect(htmlContent).toMatch(/onclick\s*=\s*["']chartExport\.exportAnalyticsPie\(\)["']/);
    });

    test('retirement chart has export button', () => {
      expect(htmlContent).toMatch(/onclick\s*=\s*["']chartExport\.exportRetirement\(\)["']/);
    });

    test('export buttons have title attribute', () => {
      expect(htmlContent).toMatch(/title\s*=\s*["']Export chart["']/);
    });

    test('net worth chart has export button', () => {
      expect(htmlContent).toMatch(/onclick\s*=\s*["']chartExport\.exportNetWorth\(\)["']/);
    });

    test('export buttons use ghost variant', () => {
      expect(htmlContent).toMatch(/class\s*=\s*["'][^"]*btn-ghost[^"]*["']/);
    });
  });

  describe('SVG export structure', () => {
    test('includes XML declaration', () => {
      expect(chartExportJs).toMatch(/<\?xml version="1.0" encoding="UTF-8"\?>/);
    });

    test('creates proper SVG namespace', () => {
      expect(chartExportJs).toMatch(/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/);
    });

    test('embeds PNG as base64 in SVG image element', () => {
      expect(chartExportJs).toMatch(/xlink:href\s*=\s*["']data:image\/png;base64/);
    });

    test('extracts base64 from data URL', () => {
      expect(chartExportJs).toMatch(/pngDataUrl\.split\s*\(\s*['"][,]['"]\s*\)/);
    });
  });
});
