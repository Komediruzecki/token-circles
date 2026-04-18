// ==================== FRONTEND APP INIT ====================

// ==================== UTILITIES ====================
const formatCurrency = (amount, currency = 'EUR') => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
};

const formatDate = (dateStr) => {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatMonth = (date) => {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const escapeHtml = (str) => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

const toast = (message, type = 'info') => {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
};

const hexToRgba = (hex, alpha = 1) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

window.formatCurrency = formatCurrency;
window.formatDate = formatDate;
window.formatMonth = formatMonth;
window.escapeHtml = escapeHtml;
window.toast = toast;
window.hexToRgba = hexToRgba;

// ==================== API ====================
const API = '/api';

function api(url, options = {}) {
  const profileRef = window.profile;
  const headers = {
    'Content-Type': 'application/json',
    'X-Profile-Id': profileRef?.currentId || '',
    ...options.headers,
  };
  const selectedIds = profileRef?.selectedIds;
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
    body: options.body && typeof options.body === 'object' ? JSON.stringify(options.body) : options.body,
  }).then(async (r) => {
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return r.json();
  });
}

window.api = api;

// ==================== NAMESPACE ====================
const FM = {};

function registerModule(name, module) {
  FM[name] = module;
  window[name] = module;
}

window.FM = FM;
window.registerModule = registerModule;

// ==================== EVENT DELEGATION ====================
function authLogin() {
  if (typeof window.FM?.auth !== 'undefined') window.FM.auth.clearLoginForm();
  if (typeof window.FM?.modal !== 'undefined') window.FM.modal.open('login-modal');
}
function importFileInput() {
  const el = document.getElementById('import-file-input');
  if (el) el.click();
}
function importFileFromInput() {
  const el = document.getElementById('import-file-input');
  if (el && el.files[0] && typeof window.FM?.importData !== 'undefined') window.FM.importData.handleFile(el.files[0]);
}

function dispatchAction(el) {
  const { action, arg, arg2 } = el.dataset;
  if (!action) return;
  const fn = typeof window[action] === 'function' ? window[action] : (() => {
    const [mod, method] = action.split(':');
    return window[mod]?.[method];
  })();
  if (typeof fn !== 'function') return;
  if (arg !== undefined && arg2 !== undefined) {
    fn(arg, arg2);
  } else if (arg !== undefined) {
    fn(arg);
  } else {
    fn(el);
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.preventDefault();
  dispatchAction(el);
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  dispatchAction(el);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target;
  if (!el.matches('[data-action]')) return;
  e.preventDefault();
  dispatchAction(el);
});

document.addEventListener('submit', (e) => {
  const el = e.target.closest('form[data-action]');
  if (!el) return;
  e.preventDefault();
  dispatchAction(el);
});

// ==================== INIT BOOTSTRAP ====================
const dz = document.getElementById('import-dropzone');
if (dz) {
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && typeof window.FM?.importData !== 'undefined') window.FM.importData.handleFile(file);
  });
}

function resetZoom() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
    setTimeout(() => {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no');
    }, 100);
  }
  toast('Zoom reset to default', 'success');
}

// ==================== ROUTER INIT ====================
// Core modules will be loaded by the build system
// This init is called after core.js loads
window.initApp = function() {
  if (typeof nav !== 'undefined') nav.init();
  if (typeof window.FM?.profile !== 'undefined') window.FM.profile.init();
  if (typeof window.FM?.theme !== 'undefined') window.FM.theme.init();
  if (typeof window.FM?.auth !== 'undefined') window.FM.auth.checkLogin();
};

// Auto-init if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initApp);
} else {
  window.initApp();
}