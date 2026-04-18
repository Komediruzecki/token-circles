// ==================== GLOBAL SINGLETON ====================
// All utilities, API, and module state is centralized here
// No global namespace pollution - everything goes through FM

// ==================== UTILITIES ====================
const Utils = {
  formatCurrency(amount, currency = 'EUR') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  },
  formatDate(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  },
  formatMonth(date) {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  },
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
  toast(message, type = 'info') {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  },
  hexToRgba(hex, alpha = 1) {
    if (!hex || hex.startsWith('#') === false) return `rgba(255,255,255,${alpha})`;
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  },
};

// ==================== API ====================
const API = '/api';

const Api = {
  async request(url, options = {}) {
    const profileRef = FM.profile;
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
  },
};

// ==================== INITIALIZATION ====================
const FM = {
  profile: {
    currentId: null,
    selectedIds: [],
    name: 'No profile',
    init: async function() {
      // Placeholder init - actual init in profile.js module
    }
  },
  api: Api.request,
  Utils: Utils,

  // Module loaders (lazy loaded from separate files)
  modules: {},

  // Register a module (called by each feature file)
  registerModule(name, module) {
    // Replace placeholder if exists, otherwise add to modules
    if (this[name] && typeof this[name] === 'object' && !this[name].api) {
      this[name] = module;
    } else {
      this.modules[name] = module;
    }
    window[name] = module;
  },

  // Get a module
  getModule(name) {
    return this.modules[name] || this[name];
  },

  // Initialize all modules for a page (including core modules like profile)
  initPage(pageName) {
    const pageModule = this.modules[pageName];
    if (pageModule && typeof pageModule.init === 'function') {
      pageModule.init();
    }
    // Also initialize core modules that aren't in modules
    const coreModules = ['profile', 'theme', 'modal'];
    if (coreModules.includes(pageName)) {
      const coreMod = this.getModule(pageName);
      if (coreMod && typeof coreMod.init === 'function') {
        coreMod.init();
      }
    }
  },

  // Load a feature module dynamically
  async loadFeature(featureName) {
    if (this.modules[featureName]) return;
    try {
      const script = document.createElement('script');
      script.src = `js/features/${featureName}.js`;
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    } catch (e) {
      console.error(`Failed to load ${featureName}:`, e);
    }
  },
};

// ==================== BOOTSTRAP ====================
window.FM = FM;
window.FORMAT_CURRENCY = Utils.formatCurrency;
window.FORMAT_DATE = Utils.formatDate;
window.FORMAT_MONTH = Utils.formatMonth;
window.ESCAPE_HTML = Utils.escapeHtml;
window.TOAST = Utils.toast;
window.HEX_TO_RGBA = Utils.hexToRgba;

// Router and nav initialization (core routing logic)
const Nav = {
  _featuresLoaded: false,
  _pendingPage: null,

  init() {
    document.querySelectorAll('.nav-item').forEach((a) => {
      a.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
        a.classList.add('active');
        const page = a.dataset.page;
        document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
        document.getElementById('page-' + page).classList.add('active');
        window.location.hash = page;

        if (!this._featuresLoaded) {
          this._pendingPage = page;
          this._loadFeatures(() => {
            this._initPage(this._pendingPage);
            this._pendingPage = null;
          });
        } else {
          this._initPage(page);
        }
      });
    });

    window.addEventListener('hashchange', () => {
      const page = window.location.hash.slice(1) || 'dashboard';
      const navItem = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (navItem) navItem.click();
    });

    const initialPage = window.location.hash.slice(1) || 'dashboard';
    const navItem = document.querySelector('.nav-item[data-page="' + initialPage + '"]');
    if (navItem) navItem.click();
    else document.querySelector('.nav-item[data-page="dashboard"]')?.click();
  },

  _loadFeatures(callback) {
    const script = document.createElement('script');
    script.src = 'js/dist/features.js';
    script.onload = () => {
      this._featuresLoaded = true;
      callback();
    };
    script.onerror = () => {
      console.error('Failed to load features bundle');
      callback();
    };
    document.head.appendChild(script);
  },

  _initPage(page) {
    FM.initPage(page);
  },
};

// Expose nav globally for inline handlers
window.nav = Nav;

// ==================== EVENT DELEGATION ====================
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.preventDefault();
  const action = el.dataset.action;
  if (!action) return;
  const [module, method] = action.split(':');
  const mod = window[module];
  if (typeof mod === 'object' && typeof mod[method] === 'function') {
    mod[method](el);
  }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  e.preventDefault();
  const action = el.dataset.action;
  if (!action) return;
  const [module, method] = action.split(':');
  const mod = window[module];
  if (typeof mod === 'object' && typeof mod[method] === 'function') {
    mod[method](el);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target;
  if (!el.matches('[data-action]')) return;
  e.preventDefault();
  const action = el.dataset.action;
  if (!action) return;
  const [module, method] = action.split(':');
  const mod = window[module];
  if (typeof mod === 'object' && typeof mod[method] === 'function') {
    mod[method](el);
  }
});

document.addEventListener('submit', (e) => {
  const el = e.target.closest('form[data-action]');
  if (!el) return;
  e.preventDefault();
  const action = el.dataset.action;
  if (!action) return;
  const [module, method] = action.split(':');
  const mod = window[module];
  if (typeof mod === 'object' && typeof mod[method] === 'function') {
    mod[method](el);
  }
});

// ==================== PAGE-SPECIFIC INIT ====================
function setupImportDropzone() {
  const dz = document.getElementById('import-dropzone');
  if (!dz) return;
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && FM.importData) {
      FM.importData.handleFile(file);
    }
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
  Utils.toast('Zoom reset to default', 'success');
}

// ==================== APP INIT ====================
window.initApp = function() {
  setupImportDropzone();
  resetZoom();
  if (typeof Nav !== 'undefined') Nav.init();
  if (typeof FM.profile !== 'undefined') FM.profile.init();
  if (typeof FM.theme !== 'undefined') FM.theme.init();
  if (typeof FM.auth !== 'undefined') FM.auth.checkLogin();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initApp);
} else {
  window.initApp();
}