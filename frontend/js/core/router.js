// ==================== NAVIGATION / ROUTER ====================
const nav = {
  init() {
    document.querySelectorAll('.nav-item').forEach((a) => {
      a.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
        a.classList.add('active');
        const page = a.dataset.page;
        document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
        document.getElementById(`page-${page}`).classList.add('active');
        window.location.hash = page;
        if (page === 'dashboard') dashboard.load();
        if (page === 'transactions') {
          txFilters.init();
          transactions.load();
        }
        if (page === 'budgets') budgets.load();
        if (page === 'loans') loans.load();
        if (page === 'categories') categories.load();
        if (page === 'analytics') analytics.init();
        if (page === 'settings') settings.load();
        if (page === 'accounts') accounts.load();
        if (page === 'import') dataImport.reset();
        if (page === 'retirement') {
          retirement.init();
          retirement.calculate();
        }
      });
    });

    // Handle hash
    window.addEventListener('hashchange', () => {
      const page = window.location.hash.slice(1) || 'dashboard';
      const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
      if (navItem) navItem.click();
    });

    // Init from hash
    const initialPage = window.location.hash.slice(1) || 'dashboard';
    const navItem = document.querySelector(`.nav-item[data-page="${initialPage}"]`);
    if (navItem) navItem.click();
    else document.querySelector('.nav-item[data-page="dashboard"]').click();
  },
};
