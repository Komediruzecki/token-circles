// ==================== THEME ====================
const theme = {
  STORAGE_KEY: 'finance-theme',
  isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  },
  toggle() {
    const dark = this.isDark();
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    localStorage.setItem(this.STORAGE_KEY, dark ? 'light' : 'dark');
    // Re-render charts with new theme colors
    if (typeof dashboard !== 'undefined' && dashboard.charts) dashboard.loadCharts();
    if (typeof loans !== 'undefined' && loans.loanCharts) {
      Object.keys(loans.loanCharts).forEach((id) => loans.loadLoanDetails(parseInt(id)));
    }
  },
  init() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    document.documentElement.setAttribute('data-theme', saved || 'light');
  },
};

// Get chart-friendly hex colors based on current theme
// Also exported for use in other modules
function chartColors() {
  const isDark = theme.isDark();
  return {
    income: '#22c55e',
    expense: '#ef4444',
    transfer: '#6366f1',
    primary: '#3b82f6',
    incomeBg: 'rgba(34,197,94,.2)',
    expenseBg: 'rgba(239,68,68,.2)',
    primaryBg: 'rgba(59,130,246,.15)',
    grid: isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
    text: isDark ? '#94a3b8' : '#64748b',
    legend: isDark ? '#f1f5f9' : '#1e293b',
  };
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.chartColors = chartColors;
}
