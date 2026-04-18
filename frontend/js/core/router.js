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

// Page init handlers using FM namespace
const PAGE_INIT = {
  dashboard: () => { FM.dashboard?.init(); },
  transactions: () => { FM.transactions?.init?.(); FM.transactions?.load?.(); },
  budgets: () => { FM.budgets?.load?.(); },
  loans: () => { FM.loans?.load?.(); },
  goals: () => { FM.savingsGoals?.load?.(); },
  bills: () => { FM.bills?.load?.(); },
  import: () => { FM.importData?.reset?.(); },
  accounts: () => { FM.accounts?.load?.(); },
  retirement: () => { FM.retirement?.init?.(); },
  housing: () => { FM.housingCalc?.init?.(); },
  analytics: () => { FM.analytics?.init?.(); FM.heatmap?.init?.(); },
  categories: () => { FM.categories?.load?.(); },
  settings: () => { FM.settings?.load?.(); },
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
