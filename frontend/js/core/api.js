// ==================== API ====================
const API = '/api';

function api(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Profile-Id': profile.currentId,
    ...options.headers,
  };
  // Send multi-profile header if in combined view
  const selectedIds = profile.selectedIds;
  if (selectedIds && selectedIds.length > 0) {
    headers['X-Profile-Ids'] = JSON.stringify(selectedIds);
  }
  if (options.method === 'DELETE' && !options.body) {
    delete headers['Content-Type'];
  }
  return fetch(API + url, {
    credentials: 'include',
    headers,
    ...options,
    body:
      options.body && typeof options.body === 'object'
        ? JSON.stringify(options.body)
        : options.body,
  }).then((r) => r.json());
}

// ==================== UTILITIES ====================
let currentMonth = new Date();

function formatCurrency(amount, currency = 'EUR') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatMonth(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function toast(message, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
