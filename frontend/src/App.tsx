/**
 * Main App Component - Root component for the application
 */

import { createSignal, onMount } from 'solid-js';
import { theme } from './core/theme';
import Dashboard from './features/Dashboard';
import Transactions from './features/Transactions';
import Budgets from './features/Budgets';
import Loans from './features/Loans';
import Goals from './features/Goals';
import Bills from './features/Bills';
import Import from './features/Import';
import Accounts from './features/Accounts';
import Categories from './features/Categories';
import Settings from './features/Settings';
import Retirement from './features/Retirement';
import Housing from './features/Housing';
import Analytics from './features/Analytics';

type PageName = 'dashboard' | 'transactions' | 'budgets' | 'loans' | 'goals' | 'bills' | 'import' | 'accounts' | 'categories' | 'settings' | 'retirement' | 'housing' | 'analytics';

const pages: Record<PageName, any> = {
  dashboard: Dashboard,
  transactions: Transactions,
  budgets: Budgets,
  loans: Loans,
  goals: Goals,
  bills: Bills,
  import: Import,
  accounts: Accounts,
  categories: Categories,
  settings: Settings,
  retirement: Retirement,
  housing: Housing,
  analytics: Analytics,
};

export default function App() {
  const [currentPage, setCurrentPage] = createSignal<PageName>('dashboard');

  onMount(() => {
    theme.init();

    // Handle hash changes for routing
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) || 'dashboard';
      const page = hash as PageName;
      if (page in pages) {
        setCurrentPage(page);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
  });

  const PageComponent = pages[currentPage()] || Dashboard;

  return (
    <div class="app-root">
      {/* Top Navigation */}
      <header class="app-header">
        <nav class="nav">
          <div class="nav-brand">
            <h1>Finance Manager</h1>
          </div>
          <ul class="nav-links">
            <li class="nav-item" data-page="dashboard">
              <a href="#dashboard">Dashboard</a>
            </li>
            <li class="nav-item" data-page="transactions">
              <a href="#transactions">Transactions</a>
            </li>
            <li class="nav-item" data-page="budgets">
              <a href="#budgets">Budgets</a>
            </li>
            <li class="nav-item" data-page="loans">
              <a href="#loans">Loans</a>
            </li>
            <li class="nav-item" data-page="goals">
              <a href="#goals">Goals</a>
            </li>
            <li class="nav-item" data-page="bills">
              <a href="#bills">Bills</a>
            </li>
            <li class="nav-item" data-page="import">
              <a href="#import">Import</a>
            </li>
            <li class="nav-item" data-page="analytics">
              <a href="#analytics">Analytics</a>
            </li>
            <li class="nav-item" data-page="settings">
              <a href="#settings">Settings</a>
            </li>
          </ul>
        </nav>

        {/* Header Actions */}
        <div class="app-actions">
          {/* Theme Toggle */}
          <button
            class="btn btn-ghost theme-toggle"
            data-action="theme:toggle"
            aria-label="Toggle theme"
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          </button>

          {/* Profile Dropdown */}
          <button id="profile-btn" class="btn btn-ghost" data-action="profile:toggle">
            <span id="profile-btn-name">Profile</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main class="app-main">
        <PageComponent />
      </main>

      {/* Modals */}
      <div id="modals"></div>

      {/* Toasts */}
      <div id="toast-container"></div>

      {/* Mobile Sidebar */}
      <div id="mobile-overlay" class="mobile-overlay"></div>
      <aside id="sidebar" class="sidebar">
        <div class="sidebar-header">
          <h2>Menu</h2>
          <button id="sidebar-close" class="sidebar-close">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav class="sidebar-nav">
          <a class="nav-item" href="#dashboard">
            <span>Dashboard</span>
          </a>
          <a class="nav-item" href="#transactions">
            <span>Transactions</span>
          </a>
          <a class="nav-item" href="#budgets">
            <span>Budgets</span>
          </a>
          <a class="nav-item" href="#loans">
            <span>Loans</span>
          </a>
          <a class="nav-item" href="#goals">
            <span>Goals</span>
          </a>
          <a class="nav-item" href="#bills">
            <span>Bills</span>
          </a>
          <a class="nav-item" href="#import">
            <span>Import</span>
          </a>
          <a class="nav-item" href="#analytics">
            <span>Analytics</span>
          </a>
          <a class="nav-item" href="#settings">
            <span>Settings</span>
          </a>
        </nav>
      </aside>
    </div>
  );
}