// ==================== DATA EXPORT ====================
function exportData(type) {
  const format = document.getElementById('export-format').value;
  window.open(`/api/export/${type}?format=${format}`, '_blank');
}

// ==================== MONTHLY PDF REPORT ====================
async function generateMonthlyPDF() {
  const year = document.getElementById('pdf-report-year').value;
  const month = document.getElementById('pdf-report-month').value;
  if (!year || !month) {
    alert('Please select a year and month');
    return;
  }

  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    const resp = await fetch(`/api/reports/monthly-pdf?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`, { credentials: 'include' });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'PDF generation failed');
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${year}-${String(month).padStart(2, '0')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Failed to generate PDF: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download Monthly PDF';
  }
}

async function populatePdfReportYears() {
  const select = document.getElementById('pdf-report-year');
  if (!select) return;
  const currentYear = new Date().getFullYear();
  try {
    const { years } = await api('/analytics/distinct-years');
    select.innerHTML = '<option value="">Year</option>';
    const allYears = [...new Set([currentYear, ...(years || [])])].sort((a, b) => b - a);
    allYears.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      select.appendChild(opt);
    });
    select.value = String(currentYear);
  } catch (e) {
    select.innerHTML = `<option value="${currentYear}">${currentYear}</option>`;
    select.value = currentYear;
  }
}

async function populateTaxSummaryYears() {
  const select = document.getElementById('tax-summary-year');
  if (!select) return;
  const currentYear = new Date().getFullYear();
  try {
    const { years } = await api('/analytics/distinct-years');
    select.innerHTML = '<option value="">Year</option>';
    const allYears = [...new Set([currentYear, ...(years || [])])].sort((a, b) => b - a);
    allYears.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      select.appendChild(opt);
    });
    select.value = String(currentYear);
  } catch (e) {
    select.innerHTML = `<option value="${currentYear}">${currentYear}</option>`;
    select.value = currentYear;
  }
}

function generateTaxSummaryPDF() {
  const year = document.getElementById('tax-summary-year').value;
  if (!year) {
    alert('Please select a year');
    return;
  }
  fetch(`/api/reports/tax-summary-pdf?year=${year}`, { credentials: 'include' })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tax-summary-${year}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch(e => alert('Failed to generate PDF: ' + e.message));
}

async function populatePlSummaryYears() {
  const select = document.getElementById('pl-summary-year');
  if (!select) return;
  const currentYear = new Date().getFullYear();
  try {
    const { years } = await api('/analytics/distinct-years');
    select.innerHTML = '<option value="">Year</option>';
    const allYears = [...new Set([currentYear, ...(years || [])])].sort((a, b) => b - a);
    allYears.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      select.appendChild(opt);
    });
    select.value = String(currentYear);
  } catch (e) {
    select.innerHTML = `<option value="${currentYear}">${currentYear}</option>`;
    select.value = currentYear;
  }
}

function generatePlSummaryPDF() {
  const year = document.getElementById('pl-summary-year').value;
  if (!year) {
    alert('Please select a year');
    return;
  }
  fetch(`/api/reports/pl-summary-pdf?year=${year}`, { credentials: 'include' })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pl-summary-${year}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch(e => alert('Failed to generate PDF: ' + e.message));
}

async function populateAnnualReportYears() {
  const select = document.getElementById('annual-report-year');
  if (!select) return;
  const currentYear = new Date().getFullYear();
  try {
    const { years } = await api('/analytics/distinct-years');
    select.innerHTML = '<option value="">Year</option>';
    const allYears = [...new Set([currentYear, ...(years || [])])].sort((a, b) => b - a);
    allYears.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      select.appendChild(opt);
    });
    select.value = String(currentYear);
  } catch (e) {
    select.innerHTML = `<option value="${currentYear}">${currentYear}</option>`;
    select.value = currentYear;
  }
}

async function generateAnnualPDF() {
  const year = document.getElementById('annual-report-year').value;
  if (!year) {
    alert('Please select a year');
    return;
  }

  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    const resp = await fetch(`/api/reports/annual-pdf?year=${encodeURIComponent(year)}`, { credentials: 'include' });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'PDF generation failed');
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annual-report-${year}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Failed to generate PDF: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download Annual PDF';
  }
}

// ==================== SETTINGS ====================
const settings = {
  async load() {
    const data = await api('/settings');
    document.getElementById('setting-currency').value = data.local_currency || 'USD';
    // Sync dark mode toggle
    const toggle = document.getElementById('setting-dark-mode');
    if (toggle) toggle.checked = theme.isDark();
    // Populate PDF report year selector
    populatePdfReportYears();
    populateTaxSummaryYears();
    populatePlSummaryYears();
    populateAnnualReportYears();
  },
  async save() {
    const data = { local_currency: document.getElementById('setting-currency').value };
    await api('/settings', { method: 'PUT', body: data });
    toast('Settings saved', 'success');
  },
  async deleteAllTransactions() {
    if (!confirm('Are you sure you want to delete ALL transactions? This cannot be undone.'))
      return;
    const typed = prompt('Type DELETE to confirm:');
    if (typed !== 'DELETE') {
      toast('Cancelled', 'info');
      return;
    }
    try {
      const result = await api('/transactions', { method: 'DELETE' });
      toast(result.message || 'All transactions deleted', 'success');
      if (typeof transactions !== 'undefined') transactions.load();
      if (typeof dashboard !== 'undefined') dashboard.load();
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
    }
  },
  async deleteAllProfileData() {
    if (
      !confirm(
        'Are you sure you want to delete ALL data for this profile?\n\nThis includes: transactions, budgets, loans, and will reset categories to defaults. This cannot be undone.'
      )
    )
      return;
    const typed = prompt('Type DELETE ALL to confirm:');
    if (typed !== 'DELETE ALL') {
      toast('Cancelled', 'info');
      return;
    }
    try {
      const result = await api('/profile/data', { method: 'DELETE' });
      toast(result.message || 'All profile data deleted', 'success');
      if (typeof transactions !== 'undefined') transactions.load();
      if (typeof dashboard !== 'undefined') dashboard.load();
      if (typeof budgets !== 'undefined') budgets.load();
      if (typeof loans !== 'undefined') loans.load();
      if (typeof categories !== 'undefined') categories.load();
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
    }
  },
  async deleteAllCategories() {
    if (!confirm('Are you sure you want to delete ALL categories? This cannot be undone.')) return;
    const typed = prompt('Type DELETE to confirm:');
    if (typed !== 'DELETE') {
      toast('Cancelled', 'info');
      return;
    }
    try {
      const result = await api('/categories', { method: 'DELETE' });
      toast(result.message || 'All categories deleted', 'success');
      if (typeof categories !== 'undefined') categories.load();
      if (typeof transactions !== 'undefined') transactions.load();
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
    }
  },
};
