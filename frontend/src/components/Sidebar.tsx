/**
 * Sidebar Component
 * Navigation sidebar with profile selector and user menu
 */

import { createSignal, onMount, For } from 'solid-js'
import styles from '@/css/Sidebar.module.css'

export default function Sidebar() {
  const [isMobileOpen, setIsMobileOpen] = createSignal(false)
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = createSignal(false)

  const navItems = [
    { page: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
    { page: 'transactions', icon: 'transactions', label: 'Transactions' },
    { page: 'budgets', icon: 'budgets', label: 'Budgets' },
    { page: 'loans', icon: 'loans', label: 'Loan Calculator' },
    { page: 'goals', icon: 'goals', label: 'Savings Goals' },
    { page: 'bills', icon: 'bills', label: 'Bills' },
    { page: 'import', icon: 'import', label: 'Import' },
    { page: 'accounts', icon: 'accounts', label: 'Accounts' },
    { page: 'retirement', icon: 'retirement', label: 'Retirement' },
    { page: 'housing', icon: 'housing', label: 'Housing Calc' },
    { page: 'analytics', icon: 'analytics', label: 'Analytics' },
    { page: 'categories', icon: 'categories', label: 'Categories' },
    { page: 'settings', icon: 'settings', label: 'Settings' },
  ]

  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const actionTrigger = target.closest('[data-action]') as HTMLElement
    if (!actionTrigger) return

    const action = actionTrigger.dataset.action
    if (action === 'toggleSidebar') {
      setIsMobileOpen(!isMobileOpen())
    } else if (action?.startsWith('profile:toggleDropdown')) {
      setIsProfileDropdownOpen(!isProfileDropdownOpen())
    } else if (action === 'auth:logout') {
      handleLogout()
    }
  }

  const handleLogout = () => {
    // Handle logout action
    console.log('Logout clicked')
    setIsProfileDropdownOpen(false)
  }

  const closeOnOutsideClick = (e: MouseEvent) => {
    const target = e.target as Element | null
    const dropdown = (e.currentTarget as HTMLElement).querySelector('[data-component="profile-dropdown-menu"]') as HTMLElement | null
    if (dropdown && target && !dropdown.contains(target) && !target.closest('[data-component="profile-dropdown-btn"]')) {
      setIsProfileDropdownOpen(false)
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClick)
    document.addEventListener('click', closeOnOutsideClick)
  })

  return (
    <>
      {/* Mobile Overlay */}
      <div class={styles.mobileOverlay} data-action="toggleSidebar" classList={{ [styles.mobileOverlayVisible]: isMobileOpen() }} />

      {/* Sidebar */}
      <nav class={styles.sidebar} data-component="sidebar">
        <div class={styles.sidebarHeader}>
          <button
            class={styles.hamburgerBtn}
            data-action="toggleSidebar"
            aria-label="Toggle menu"
          >
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        <div class={styles.sidebarLogo}>
          <h1>Finance<span>.</span></h1>
          <p>Personal Finance Tracker</p>
        </div>

        <div class={styles.profileSelector}>
          <div class={styles.profileDropdown}>
            <button
              class={styles.profileDropdownBtn}
              data-component="profile-dropdown-btn"
              data-action="profile:toggleDropdown"
            >
              <span class={styles.profileName} id="profile-btn-name">Loading...</span>
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div class={styles.profileDropdownMenu} data-component="profile-dropdown-menu" />
          </div>
        </div>

        <div style="padding: 0 16px; margin-bottom: 12px">
          <div id="login-section">
            <button class={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`} style="width: 100%" data-action="authLogin">
              Sign In
            </button>
          </div>
          <div id="user-section" style="display: none">
            <div style="display: flex; align-items: center; gap: 8px; padding: 6px 0">
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
                style="flex-shrink: 0"
              >
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span
                id="username-display"
                style="
                  flex: 1;
                  font-size: 13px;
                  font-weight: 500;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                "
              ></span>
              <button
                class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                data-action="auth:logout"
                title="Logout"
                style="padding: 4px 6px; flex-shrink: 0"
              >
                <svg
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <nav class={styles.sidebarNav}>
          <For each={navItems}>
            {(item) => (
              <a
                href={`#${item.page}`}
                class={`${styles.navItem} ${styles.navItemActive}`}
                data-page={item.page}
              >
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  {item.icon === 'dashboard' && (
                    <>
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </>
                  )}
                  {item.icon === 'transactions' && (
                    <path
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  )}
                  {item.icon === 'budgets' && (
                    <path
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  )}
                  {item.icon === 'loans' && (
                    <path
                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                    />
                  )}
                  {item.icon === 'goals' && (
                    <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  )}
                  {item.icon === 'bills' && (
                    <path
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                    />
                  )}
                  {item.icon === 'import' && (
                    <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  )}
                  {item.icon === 'accounts' && (
                    <path
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                    />
                  )}
                  {item.icon === 'retirement' && (
                    <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  )}
                  {item.icon === 'housing' && (
                    <path
                      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                    />
                  )}
                  {item.icon === 'analytics' && (
                    <path
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  )}
                  {item.icon === 'categories' && (
                    <path
                      d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                    />
                  )}
                  {item.icon === 'settings' && (
                    <>
                      <path
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
                <span>{item.label}</span>
              </a>
            )}
          </For>
        </nav>

        <div class={styles.sidebarFooter}>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
            <span>Finance Manager v1.0</span>
            <button
              class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
              data-action="resetZoom"
              title="Reset zoom to default"
              style="padding: 4px 8px; font-size: 11px"
            >
              Reset Zoom
            </button>
          </div>
        </div>
      </nav>
    </>
  )
}