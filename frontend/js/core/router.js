// ==================== NAVIGATION / ROUTER ====================

// Mobile sidebar toggle
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  sidebar.classList.toggle('collapsed');
  overlay.classList.toggle('show');
}

// Close sidebar when navigating on mobile
function closeSidebarOnNavigate() {
  if (window.innerWidth <= 768) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    if (!sidebar.classList.contains('collapsed')) {
      sidebar.classList.add('collapsed');
      overlay.classList.remove('show');
    }
  }
}

// Page init handlers
const PAGE_INIT = {
  dashboard: () => { dashboard.init(); },
  transactions: () => { txFilters.init(); transactions.load(); },
  budgets: () => { budgets.load(); },
  loans: () => { loans.load(); },
  goals: () => { savingsGoals.load(); },
  bills: () => { bills.load(); },
  import: () => { if (typeof dataImport !== 'undefined') dataImport.reset(); },
  accounts: () => { if (typeof accounts !== 'undefined') accounts.load(); },
  retirement: () => { if (typeof retirement !== 'undefined') retirement.init(); },
  housing: () => { if (typeof housingCalc !== 'undefined') housingCalc.init(); },
  analytics: () => { if (typeof analytics !== 'undefined') analytics.init(); if (typeof heatmap !== 'undefined') heatmap.init(); },
  categories: () => { categories.load(); },
  settings: () => { settings.load(); },
};

const nav = {
  _featuresLoaded: false,
  _pendingPage: null,

  init() {
    document.querySelectorAll('.nav-item').forEach((a) => {
      a.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
        a.classList.add('active');
        const page = a.dataset.page;
        document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
        document.getElementById(`page-${page}`).classList.add('active');
        window.location.hash = page;
        closeSidebarOnNavigate();

        // Load features bundle lazily on first navigation
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
      const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
      if (navItem) navItem.click();
    });

    const initialPage = window.location.hash.slice(1) || 'dashboard';
    const navItem = document.querySelector(`.nav-item[data-page="${initialPage}"]`);
    if (navItem) navItem.click();
    else document.querySelector('.nav-item[data-page="dashboard"]').click();
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
    const init = PAGE_INIT[page];
    if (init) init();
  },
};
