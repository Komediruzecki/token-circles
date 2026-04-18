// ==================== FRONTEND APP INIT ====================
// Uses FM namespace from app-singleton.js for utilities and API
// This module only handles app-specific initialization and event delegation

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
  if (typeof FM?.Utils?.toast !== 'undefined') {
    FM.Utils.toast('Zoom reset to default', 'success');
  } else {
    toast('Zoom reset to default', 'success');
  }
}

// ==================== ROUTER INIT ====================
// Core modules are loaded via core.js (app-singleton.js)
// This init is called after core.js loads
window.initApp = function() {
  if (typeof nav !== 'undefined') nav.init();
  // Initialize core modules
  if (typeof FM !== 'undefined') {
    const profile = FM.getModule('profile');
    const theme = FM.getModule('theme');
    const auth = FM.getModule('auth');
    if (profile?.init) profile.init();
    if (theme?.init) theme.init();
    if (auth?.checkLogin) auth.checkLogin();
  }
};

// Auto-init if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initApp);
} else {
  window.initApp();
}