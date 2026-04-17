// ==================== CHART EXPORT ====================
const chartExport = {
  /**
   * Export a chart as PNG image
   * @param {HTMLCanvasElement} canvas - The canvas element from Chart.js
   * @param {string} filename - The filename for download
   */
  exportAsPng(canvas, filename = 'chart.png') {
    if (!canvas) {
      toast('No chart available to export', 'error');
      return;
    }
    try {
      const link = document.createElement('a');
      link.download = filename;
      link.href = canvas.toDataURL('image/png', 1.0);
      link.click();
      toast('Chart exported as PNG', 'success');
    } catch (e) {
      toast('Failed to export chart as PNG', 'error');
      console.error('PNG export error:', e);
    }
  },

  /**
   * Export a chart as SVG image
   * Uses a temporary canvas to render, then converts to SVG-like data
   * This preserves the raster chart as an SVG container
   * @param {HTMLCanvasElement} canvas - The canvas element from Chart.js
   * @param {string} filename - The filename for download
   */
  exportAsSvg(canvas, filename = 'chart.svg') {
    if (!canvas) {
      toast('No chart available to export', 'error');
      return;
    }
    try {
      // Get PNG data URL
      const pngDataUrl = canvas.toDataURL('image/png', 1.0);

      // Create SVG with embedded PNG image
      const svgWidth = canvas.width;
      const svgHeight = canvas.height;

      // Base64 encode the PNG data
      const base64 = pngDataUrl.split(',')[1];

      const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <title>Exported Chart</title>
  <image width="${svgWidth}" height="${svgHeight}" xlink:href="data:image/png;base64,${base64}"/>
</svg>`;

      const blob = new Blob([svgContent], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      toast('Chart exported as SVG', 'success');
    } catch (e) {
      toast('Failed to export chart as SVG', 'error');
      console.error('SVG export error:', e);
    }
  },

  /**
   * Export chart with format selection dialog
   * @param {HTMLCanvasElement} canvas - The canvas element from Chart.js
   * @param {string} defaultFilename - Default filename without extension
   */
  showExportDialog(canvas, defaultFilename = 'chart') {
    const format = prompt('Export format: png or svg', 'png');
    if (!format) return;

    const normalizedFormat = format.toLowerCase().trim();
    if (normalizedFormat === 'png') {
      this.exportAsPng(canvas, `${defaultFilename}.png`);
    } else if (normalizedFormat === 'svg') {
      this.exportAsSvg(canvas, `${defaultFilename}.svg`);
    } else {
      toast('Invalid format. Use png or svg.', 'error');
    }
  },

  /**
   * Export dashboard spending chart
   */
  exportDashboardCategory() {
    const canvas = document.getElementById('chart-category');
    const year = document.getElementById('dashboard-year')?.value || new Date().getFullYear();
    this.showExportDialog(canvas, `spending-${year}`);
  },

  /**
   * Export dashboard monthly chart
   */
  exportDashboardMonthly() {
    const canvas = document.getElementById('chart-monthly');
    const year = document.getElementById('dashboard-year')?.value || new Date().getFullYear();
    this.showExportDialog(canvas, `monthly-${year}`);
  },

  /**
   * Export dashboard cashflow chart
   */
  exportDashboardCashflow() {
    const canvas = document.getElementById('chart-cashflow');
    const year = document.getElementById('dashboard-year')?.value || new Date().getFullYear();
    this.showExportDialog(canvas, `cashflow-${year}`);
  },

  /**
   * Export analytics stacked chart
   */
  exportAnalyticsStacked() {
    const canvas = document.getElementById('analytics-stacked-chart');
    const year = document.getElementById('analytics-year')?.value || new Date().getFullYear();
    const month = document.getElementById('analytics-month-filter')?.value || '';
    const filename = month ? `trends-${year}-${month}` : `trends-${year}`;
    this.showExportDialog(canvas, filename);
  },

  /**
   * Export analytics pie chart
   */
  exportAnalyticsPie() {
    const canvas = document.getElementById('analytics-pie-chart');
    const year = document.getElementById('analytics-year')?.value || new Date().getFullYear();
    this.showExportDialog(canvas, `breakdown-${year}`);
  },

  /**
   * Export sankey diagram as SVG
   */
  exportSankey() {
    const svg = document.getElementById('sankey-chart');
    const year = document.getElementById('analytics-year')?.value || new Date().getFullYear();
    const month = document.getElementById('sankey-month-filter')?.value || '';
    const filename = month ? `sankey-${year}-${month}` : `sankey-${year}`;

    if (!svg) {
      toast('No sankey chart available to export', 'error');
      return;
    }

    try {
      // Get SVG as text
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);

      // Create blob and download
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${filename}.svg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      toast('Sankey diagram exported as SVG', 'success');
    } catch (e) {
      toast('Failed to export sankey as SVG', 'error');
      console.error('SVG export error:', e);
    }
  },

  /**
   * Export loan amortization chart
   */
  exportLoanAmortization() {
    const canvas = document.getElementById('amort-chart');
    const loanName = document.getElementById('loan-name')?.value || 'loan';
    const safeName = loanName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
    this.showExportDialog(canvas, `amortization-${safeName}`);
  },

  /**
   * Export retirement chart
   */
  exportRetirement() {
    const canvas = document.getElementById('ret-chart');
    this.showExportDialog(canvas, 'retirement-plan');
  },

  /**
   * Export net worth over time chart
   */
  exportNetWorth() {
    const canvas = document.getElementById('chart-networth');
    this.showExportDialog(canvas, 'net-worth');
  }
};
