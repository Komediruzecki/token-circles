// ==================== EVENT DELEGATION ====================
// Compound action helpers (for multi-step handlers)
function authLogin() {
  if (typeof auth !== 'undefined') auth.clearLoginForm();
  if (typeof modal !== 'undefined') modal.open('login-modal');
}
function importFileInput() {
  const el = document.getElementById('import-file-input');
  if (el) el.click();
}
function importFileFromInput() {
  const el = document.getElementById('import-file-input');
  if (el && el.files[0] && typeof dataImport !== 'undefined') dataImport.handleFile(el.files[0]);
}

// Centralized action dispatcher — resolves module:method or named helper
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
// Drag and drop for import
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
    if (file && typeof dataImport !== 'undefined') dataImport.handleFile(file);
  });
}

// Reset zoom to default (for mobile zoom prevention)
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

// Nav init is in core (router.js) — nav handles page feature loading
nav.init();
if (typeof profile !== 'undefined') profile.init();
if (typeof theme !== 'undefined') theme.init();
if (typeof auth !== 'undefined') auth.checkLogin();
