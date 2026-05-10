/**
 * Main App Component - Root component for the application
 */

import { createSignal, For, onCleanup, onMount, Show, Suspense } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import ConfirmDialog from './components/ConfirmDialog'
import layoutStyles from './components/Layout.module.css'
import LoginModal from './components/LoginModal'
import profileStyles from './components/Profile.module.css'
import ProfileModal from './components/ProfileModal'
import QuickAddModal from './components/QuickAddModal'
import ToastContainer from './components/ToastContainer'
import { api, toast } from './core/api.js'
import { logger } from './core/logger.js'
import { pages as allPages } from './router.tsx'
import type { PageName } from './router.tsx'
import type { Category } from './types/models'

export function App() {
  const [_currentPage, _setCurrentPage] = createSignal<PageName>('dashboard')
  const [_isLoading, _setIsLoading] = createSignal(true)
  const [activePage, setActivePage] = createSignal<PageName>('dashboard')
  const [profiles, setProfiles] = createSignal<any[]>([])
  const [currentProfile, setCurrentProfile] = createSignal<any>(null)
  const [isAuthenticated, setIsAuthenticated] = createSignal(false)
  const [showDropdown, setShowDropdown] = createSignal(false)
  const [isLoginModalOpen, setIsLoginModalOpen] = createSignal(false)
  const [isProfileModalOpen, setIsProfileModalOpen] = createSignal(false)
  const [isQuickAddOpen, setIsQuickAddOpen] = createSignal(false)
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(true)
  const [quickAddCategories, setQuickAddCategories] = createSignal<Category[]>([])

  const loadProfiles = async (autoSelect = false) => {
    try {
      const data = await api.getProfiles()
      setProfiles(data)

      if (autoSelect && data.length > 0) {
        const savedId = localStorage.getItem('currentProfileId')
        let activeProfile = null
        if (savedId) {
          activeProfile = data.find((p) => p.id === parseInt(savedId))
        }
        if (!activeProfile) {
          activeProfile = data[0]
          localStorage.setItem('currentProfileId', activeProfile.id.toString())
        }
        setCurrentProfile(activeProfile)
      }
    } catch {
      setProfiles([])
    }
  }

  const selectProfile = async (profileId: number) => {
    try {
      localStorage.setItem('currentProfileId', profileId.toString())
      setCurrentProfile(profiles().find((p) => p.id === profileId))
      setShowDropdown(false)
      // Force page content to refresh by briefly showing loading
      _setIsLoading(true)
      setTimeout(() => _setIsLoading(false), 50)
    } catch {
      console.error('Failed to select profile')
    }
  }

  const toggleDropdown = () => {
    setShowDropdown((prev) => !prev)
  }

  const handleLogin = () => {
    setIsLoginModalOpen(true)
  }

  const handleLoginSuccess = async () => {
    setIsLoginModalOpen(false)
    setIsAuthenticated(true)
    await loadProfiles()
    if (profiles().length > 0) {
      const savedProfileId = localStorage.getItem('currentProfileId')
      const selectedProfile = profiles().find(
        (p) => p.id === (savedProfileId ? parseInt(savedProfileId) : null) || p.id === 1
      )
      if (selectedProfile) {
        setCurrentProfile(selectedProfile)
      } else {
        setCurrentProfile(profiles()[0])
      }
    }
    setShowDropdown(false)
  }

  const handleLogout = async () => {
    try {
      await api.logout()
    } catch (_error) {
      logger.error('Logout API call failed', {}, 'App')
    }
    localStorage.removeItem('currentProfileId')
    setIsAuthenticated(false)
    setCurrentProfile(null)
    await loadProfiles(true)
    setShowDropdown(false)
    toast('Logged out', 'info')
  }

  onMount(async () => {
    // Initialize logging system
    logger.init()

    // Initialize theme (dark by default)
    const savedTheme = localStorage.getItem('finance-theme')
    if (savedTheme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      document.documentElement.setAttribute('data-theme', 'dark')
    }

    await api.checkLogin().then(async (loggedIn) => {
      setIsAuthenticated(loggedIn)
      if (loggedIn) {
        await loadProfiles(true)
      } else {
        await loadProfiles(false)
        // Default to first profile if not strictly logged in but profiles exist
        if (profiles().length > 0) {
          setCurrentProfile(profiles()[0])
        }
      }
    })

    // Parse initial hash from URL (supports #pagename?param=value)
    const rawHash = window.location.hash.slice(1)
    const hashPage = rawHash.split('?')[0]
    if (hashPage && allPages[hashPage as PageName]) {
      setActivePage(hashPage as PageName)
    } else {
      setActivePage('dashboard')
    }

    // Load categories for Quick Add
    try {
      const cats = await api.getCategories()
      if (Array.isArray(cats)) setQuickAddCategories(cats as Category[])
    } catch {
      /* non-critical */
    }

    // Quick Add keyboard shortcut: Ctrl/Cmd+Shift+T
    const handleQuickAddKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        setIsQuickAddOpen(true)
      }
    }
    document.addEventListener('keydown', handleQuickAddKey)
    onCleanup(() => {
      document.removeEventListener('keydown', handleQuickAddKey)
    })

    _setIsLoading(false)
  })

  // Listen for hash changes (back/forward buttons, manual URL edits)
  const handleHashChange = () => {
    const newRawHash = window.location.hash.slice(1)
    const newHashPage = newRawHash.split('?')[0]
    if (newHashPage && allPages[newHashPage as PageName]) {
      setActivePage(newHashPage as PageName)
    }
  }
  window.addEventListener('hashchange', handleHashChange)
  onCleanup(() => {
    window.removeEventListener('hashchange', handleHashChange)
  })

  // Listen for unauthorized API calls
  const handleAuthRequired = () => {
    // Clear profile state and prompt login
    setIsAuthenticated(false)
    setCurrentProfile(null)
    localStorage.removeItem('currentProfileId')
    handleLogin()
  }
  window.addEventListener('auth:required', handleAuthRequired)
  onCleanup(() => {
    window.removeEventListener('auth:required', handleAuthRequired)
  })

  // Navigation items with icons for sidebar
  const navItems = [
    {
      name: 'dashboard' as PageName,
      label: 'Dashboard',
      icon: (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      ),
    },
    {
      name: 'transactions' as PageName,
      label: 'Transactions',
      icon: (
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      ),
    },
    {
      name: 'budgets' as PageName,
      label: 'Budgets',
      icon: (
        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      ),
    },
    {
      name: 'loans' as PageName,
      label: 'Loans',
      icon: (
        <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      ),
    },
    {
      name: 'goals' as PageName,
      label: 'Savings Goals',
      icon: <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
    },
    {
      name: 'bills' as PageName,
      label: 'Bills',
      icon: (
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      ),
    },
    {
      name: 'rentBuy' as PageName,
      label: 'Rent vs Buy',
      icon: (
        <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      ),
    },
    {
      name: 'compound' as PageName,
      label: 'Compound Interest',
      icon: (
        <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      ),
    },
    {
      name: 'emergency' as PageName,
      label: 'Emergency Fund',
      icon: <path d="M13 10V3L4 14h7v7l9-11h-7z" />,
    },
    {
      name: 'import' as PageName,
      label: 'Import',
      icon: <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />,
    },
    {
      name: 'accounts' as PageName,
      label: 'Accounts',
      icon: (
        <path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      ),
    },
    {
      name: 'counterparties' as PageName,
      label: 'Counterparties',
      icon: (
        <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      ),
    },
    {
      name: 'portfolio' as PageName,
      label: 'Portfolio',
      icon: (
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.86L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      ),
    },
    {
      name: 'retirement' as PageName,
      label: 'Retirement',
      icon: <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
    },
    {
      name: 'housing' as PageName,
      label: 'Housing',
      icon: (
        <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      ),
    },
    {
      name: 'analytics' as PageName,
      label: 'Analytics',
      icon: (
        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      ),
    },
    {
      name: 'settings' as PageName,
      label: 'Settings',
      icon: (
        <>
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ),
    },
  ]

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <div
        class={layoutStyles.sidebar}
        classList={{ [layoutStyles.collapsed]: sidebarCollapsed() }}
      >
        <div class={layoutStyles.sidebarLogo}>
          <h1>
            Finance<span>.</span>
          </h1>
          <p>Personal Finance Tracker</p>
        </div>
        <div class={profileStyles.profileSelector}>
          <div class={profileStyles.profileDropdown}>
            <button
              class={profileStyles.profileDropdownBtn}
              onClick={toggleDropdown}
              style={{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'space-between',
                width: '100%',
              }}
            >
              <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    'border-radius': '50%',
                    background: 'var(--primary)',
                    color: 'white',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    'font-size': '12px',
                    'font-weight': 'bold',
                  }}
                >
                  {currentProfile() ? currentProfile().name.charAt(0).toUpperCase() : '?'}
                </div>
                <span class={profileStyles.profileName} style={{ 'font-weight': 600 }}>
                  {currentProfile() ? currentProfile().name : 'Not Logged In'}
                </span>
              </div>
              <svg
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
                style={{
                  width: '16px',
                  height: '16px',
                  transition: 'transform 0.2s',
                  transform: showDropdown() ? 'rotate(180deg)' : 'none',
                }}
              >
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div
              class={`${profileStyles.profileDropdownMenu} ${showDropdown() ? profileStyles.visible : ''}`}
            >
              <div class={profileStyles.profileDropdownHeader}>Switch Profile</div>
              {profiles().length > 0 ? (
                <For each={profiles()}>
                  {(profile) => (
                    <div
                      class={`${profileStyles.profileDropdownItem} ${currentProfile()?.id === profile.id ? profileStyles.active : ''}`}
                      onClick={() => selectProfile(profile.id)}
                    >
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          'border-radius': '50%',
                          background:
                            currentProfile()?.id === profile.id ? 'var(--primary)' : 'transparent',
                          border:
                            currentProfile()?.id === profile.id
                              ? 'none'
                              : '1px solid var(--border)',
                          'margin-right': '8px',
                        }}
                      ></div>
                      {profile.name}
                    </div>
                  )}
                </For>
              ) : (
                <div class={profileStyles.profileDropdownItem} onClick={handleLogin}>
                  Sign In
                </div>
              )}

              <div
                class={profileStyles.profileDropdownItem}
                onClick={() => setIsProfileModalOpen(true)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  style={{ 'margin-right': '8px' }}
                >
                  <path d="M12 4v16m8-8H4" />
                </svg>
                Create Profile
              </div>

              {isAuthenticated() && currentProfile() ? (
                <>
                  <div class={profileStyles.profileDropdownDivider}></div>
                  <div
                    class={profileStyles.profileDropdownItem}
                    onClick={handleLogin}
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      style={{ 'margin-right': '8px' }}
                    >
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    Manage Account
                  </div>
                </>
              ) : (
                <>
                  <div class={profileStyles.profileDropdownDivider}></div>
                  <div class={profileStyles.profileDropdownItem} onClick={handleLogin}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      style={{ 'margin-right': '8px' }}
                    >
                      <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
                    </svg>
                    Sign In
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ padding: '0 16px', 'margin-bottom': '12px' }}>
          {isAuthenticated() && currentProfile() ? (
            <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '6px 0' }}>
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
                style={{ 'flex-shrink': 0 }}
              >
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span
                style={{
                  flex: 1,
                  'font-size': '13px',
                  'font-weight': 500,
                  overflow: 'hidden',
                  'text-overflow': 'ellipsis',
                  'white-space': 'nowrap',
                }}
              >
                {currentProfile().name}
              </span>
              <button
                class={`${layoutStyles.btn} ${layoutStyles.btnGhost} ${layoutStyles.btnSm}`}
                onClick={handleLogout}
                title="Logout"
                style={{ padding: '4px 6px', 'flex-shrink': 0 }}
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
          ) : (
            <button
              class={`${layoutStyles.btn} ${layoutStyles.btnPrimary}`}
              style={{ width: '100%' }}
              onClick={handleLogin}
            >
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
              </svg>
              Login
            </button>
          )}
        </div>
        <nav class={layoutStyles.sidebarNav}>
          {navItems.map((item) => (
            <a
              href={`#${item.name}`}
              class={
                activePage() === item.name
                  ? layoutStyles.sidebarNavActive
                  : layoutStyles.sidebarNavLink
              }
              onClick={(e) => {
                e.preventDefault()
                setActivePage(item.name)
                setSidebarCollapsed(true)
                window.location.hash = item.name
              }}
            >
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                {item.icon}
              </svg>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </div>

      <Show when={!sidebarCollapsed()}>
        <div class={layoutStyles['sidebar-overlay']} onClick={() => setSidebarCollapsed(true)} />
      </Show>

      <button
        class={layoutStyles['mobile-toggle']}
        onClick={() => setSidebarCollapsed((v) => !v)}
        aria-label="Toggle sidebar"
      >
        <svg
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d={sidebarCollapsed() ? 'M4 6h16M4 12h16M4 18h16' : 'M6 18L18 6M6 6l12 12'} />
        </svg>
      </button>

      <main class={layoutStyles.main}>
        {Object.entries(allPages).map(([name, page]) => (
          <Show when={activePage() === name && !_isLoading()}>
            <Dynamic component={page} data-testid={`page-${name}`} />
          </Show>
        ))}
      </main>

      <Show when={isLoginModalOpen()}>
        <LoginModal onClose={() => setIsLoginModalOpen(false)} onSuccess={handleLoginSuccess} />
      </Show>

      <Show when={isProfileModalOpen()}>
        <ProfileModal
          onClose={() => setIsProfileModalOpen(false)}
          onSuccess={() => {
            setIsProfileModalOpen(false)
            loadProfiles(true)
          }}
        />
      </Show>

      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        categories={() => quickAddCategories()}
        onSave={(_transaction) => {
          toast('Transaction added', 'success')
        }}
      />

      <ToastContainer />
      <ConfirmDialog />
    </Suspense>
  )
}
