// ==================== NAMESPACE MANAGER ====================
// Centralized namespace for all finance-manager modules
// This prevents variable name conflicts and provides a single source of truth

const FM = {
  // Core modules
  api: null,
  auth: null,
  modal: null,
  theme: null,
  profile: null,

  // Feature modules
  analytics: null,
  bills: null,
  budgets: null,
  bulkEdit: null,
  chartExport: null,
  dashboard: null,
  heatmap: null,
  housingCalc: null,
  importData: null,
  loans: null,
  quickAdd: null,
  retirement: null,
  savingsGoals: null,
  settings: null,
  transactions: null,
  categories: null,
  accounts: null,

  // Utility functions
  utils: {},

  // Initialize all modules
  async init() {
    // Initialize core modules
    await this.initCore();

    // Initialize feature modules
    await this.initFeatures();
  },

  async initCore() {
    // Core modules are in /frontend/js/core/
    const corePath = '/js/core/';
    const coreFiles = [
      'api.js',
      'auth.js',
      'modal.js',
      'theme.js',
      'profile.js'
    ];

    for (const file of coreFiles) {
      try {
        const mod = await import(corePath + file);
        if (mod.default || mod) {
          const moduleName = file.replace('.js', '');
          this[moduleName] = mod.default || mod;

          // Backward compatibility: also set on window
          if (typeof window !== 'undefined') {
            window[moduleName] = this[moduleName];
          }
        }
      } catch (e) {
        console.warn(`Failed to load core module ${file}:`, e);
      }
    }
  },

  async initFeatures() {
    // Features are in /frontend/js/features/
    const featurePath = '/js/features/';
    const featureFiles = [
      'analytics.js',
      'bills.js',
      'budgets.js',
      'bulkEdit.js',
      'chartExport.js',
      'dashboard.js',
      'heatmap.js',
      'housingCalc.js',
      'import.js',
      'loans.js',
      'quickadd.js',
      'retirement.js',
      'savingsGoals.js',
      'settings-reports.js',
      'transactions.js',
      'categories-accounts.js'
    ];

    for (const file of featureFiles) {
      try {
        const mod = await import(featurePath + file);
        if (mod.default || mod) {
          const moduleName = file.replace('.js', '');
          this[moduleName] = mod.default || mod;

          // Backward compatibility: also set on window
          if (typeof window !== 'undefined') {
            window[moduleName] = this[moduleName];
          }
        }
      } catch (e) {
        console.warn(`Failed to load feature module ${file}:`, e);
      }
    }
  },

  // Register a module
  register(name, module) {
    this[name] = module;
    if (typeof window !== 'undefined') {
      window[name] = module;
    }
  },

  // Get a module (helps resolve typeof checks)
  get(name) {
    return this[name] || (typeof window !== 'undefined' && window[name]);
  }
};

// Make namespace globally available
if (typeof window !== 'undefined') {
  window.FM = FM;
}