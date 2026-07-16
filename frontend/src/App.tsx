/**
 * Main App Component - Root component for the application
 */

import {
  createEffect,
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js'
import { Dynamic } from 'solid-js/web'
import CommandBar from './components/CommandBar'
import ConfirmDialog from './components/ConfirmDialog'
import GuidedOrbit from './components/GuidedOrbit'
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal'
import layoutStyles from './components/Layout.module.css'
import LoginModal from './components/LoginModal'
import LoginScreen from './components/LoginScreen'
import { LogoMark } from './components/Logo'
import { OrbitBootScreen } from './components/OrbitSpinner'
import profileStyles from './components/Profile.module.css'
import ProfileModal from './components/ProfileModal'
import ResetPassword from './components/ResetPassword'
import Spotlight from './components/Spotlight'
import ToastContainer from './components/ToastContainer'
import TourSelectionModal from './components/TourSelectionModal'
import { api, toast } from './core/api.js'
import {
  bumpProfileVersion,
  setCurrentProfile as setCurrentProfileStore,
  setIsAuthenticated as setIsAuthenticatedStore,
  setIsLoginModalOpen as setIsLoginModalOpenStore,
  setIsProfileModalOpen as setIsProfileModalOpenStore,
  setIsQuickAddOpen as setIsQuickAddOpenStore,
  setLoading,
  setPage,
  setProfiles as setProfilesStore,
  setQuickAddCategories as setQuickAddCategoriesStore,
  setShowDropdown as setShowDropdownStore,
  setSidebarCollapsed as setSidebarCollapsedStore,
  useAppState,
} from './core/appStore'
import { initVersionWatch } from './core/appVersion'
import { loadBillingPlan } from './core/billingStore'
import { DEMO_PROFILE_NAME, getDemoTier } from './core/demoMode'
import { logger } from './core/logger.js'
import { maybeOfferOnboarding, onboardingOpen } from './core/onboardingStore'
import { initPeriodSync, orbitOpen, stepPeriod } from './core/periodStore'
import { setShowShortcuts, showShortcuts } from './core/shortcutsStore'
import {
  setShowTourSelection,
  showTourSelection,
  spotlightActive,
  spotlightStep,
  tourSteps,
} from './core/spotlightStore'
import { getStorageMode, setStorageMode } from './core/storage/storageFactory'
import { pages as allPages } from './router.tsx'
import type { PageName } from './router.tsx'
import type { Category, Profile } from './types/models'

// Loaded on demand: only pristine first-run profiles (or an explicit relaunch
// from the tour menu) ever open the wizard, so it stays out of the main chunk.
const OnboardingWizard = lazy(() => import('./components/onboarding/OnboardingWizard'))

export function App() {
  // Shared app store — replaces 12 inline signals
  const state = useAppState()
  // Server (self-hosted) mode requires a real session; client-only (serverless/demo) mode
  // never gates. Mode is fixed per load (a Settings change reloads the page).
  const serverMode = getStorageMode() === 'self-hosted'
  // Password-reset magic link (#reset-password?token=…). Rendered before the auth gate so it
  // works regardless of storage mode or session.
  const isResetRoute = window.location.hash.slice(1).split('?')[0] === 'reset-password'
  const activePage = () => state.page
  const setActivePage = (p: PageName) => {
    setPage(p)
  }
  const _isLoading = () => state.loading
  const _setIsLoading = (v: boolean) => {
    setLoading(v)
  }
  const profiles = () => state.profiles as Profile[]
  const setProfiles = (p: Profile[]) => {
    setProfilesStore(p)
  }
  const currentProfile = () => state.currentProfile
  const setCurrentProfile = (p: Profile | null) => {
    setCurrentProfileStore(p)
  }
  const isAuthenticated = () => state.isAuthenticated
  const setIsAuthenticated = (v: boolean) => {
    setIsAuthenticatedStore(v)
  }
  const showDropdown = () => state.showDropdown
  const setShowDropdown = (v: boolean) => {
    setShowDropdownStore(v)
  }
  const isLoginModalOpen = () => state.isLoginModalOpen
  const setIsLoginModalOpen = (v: boolean) => {
    setIsLoginModalOpenStore(v)
  }
  const isProfileModalOpen = () => state.isProfileModalOpen
  const setIsProfileModalOpen = (v: boolean) => {
    setIsProfileModalOpenStore(v)
  }
  const isQuickAddOpen = () => state.isQuickAddOpen
  const setIsQuickAddOpen = (v: boolean) => {
    setIsQuickAddOpenStore(v)
  }
  const sidebarCollapsed = () => state.sidebarCollapsed
  const setSidebarCollapsed = (v: boolean) => {
    setSidebarCollapsedStore(v)
  }
  const quickAddCategories = () => state.quickAddCategories
  const setQuickAddCategories = (c: Category[]) => {
    setQuickAddCategoriesStore(c)
  }
  // Touch-friendly quick entry (Guided Orbit), opened by the floating + button.
  const [isGuidedOpen, setIsGuidedOpen] = createSignal(false)

  // Keep-alive page mounting: pages stay mounted after first visit, hidden
  // via CSS instead of destroyed. Navigation becomes instant — no re-fetch,
  // no spinner, no lost scroll position.
  const [mountedPages, setMountedPages] = createSignal(new Set<string>([activePage()]))
  createEffect(() => {
    const current = activePage()
    setMountedPages((prev) => {
      if (prev.has(current)) return prev
      const next = new Set(prev)
      next.add(current)
      return next
    })
  })

  const loadProfiles = async (autoSelect = false) => {
    try {
      const data = await api.getProfiles()
      // Deduplicate profiles by ID (can happen after clear + reseed with stale state)
      const seen = new Set<number>()
      const unique = data.filter((p) => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
      })
      setProfiles(unique)

      if (autoSelect && unique.length > 0) {
        const savedId = localStorage.getItem('currentProfileId')
        let activeProfile = null
        if (savedId) {
          activeProfile = unique.find((p) => p.id === parseInt(savedId))
        }
        if (!activeProfile) {
          activeProfile = unique[0]
          localStorage.setItem('currentProfileId', activeProfile.id.toString())
        }
        setCurrentProfile(activeProfile)
      }
    } catch {
      setProfiles([])
    }
    // Refresh selected IDs after profile list changes (e.g., after data reset)
    setSelectedProfileIds(getSelectedProfileIds())
  }

  const selectProfile = (profileId: number) => {
    localStorage.setItem('currentProfileId', profileId.toString())
    // Set only this profile as selected (clears multi-select)
    localStorage.setItem('selectedProfileIds', JSON.stringify([profileId]))
    setSelectedProfileIds([profileId])
    // Shallow-copy from profiles() to avoid store-proxy cross-reference
    // (setting a proxy from one store path as value at another path can
    //  cause spurious reactivity that briefly corrupts the profiles list)
    const found = profiles().find((p) => p.id === profileId)
    setCurrentProfile(found ? { ...found } : null)
    setShowDropdown(false)
    bumpProfileVersion()
    // State is updated via bumpProfileVersion()
  }

  const getSelectedProfileIds = (): number[] => {
    const stored = localStorage.getItem('selectedProfileIds')
    if (stored) {
      try {
        const ids = JSON.parse(stored) as number[]
        if (Array.isArray(ids) && ids.length > 0) {
          // Dedup and filter to existing profiles only
          const existingIds = new Set(profiles().map((p) => p.id))
          const valid = [...new Set(ids)].filter((id) => existingIds.has(id))
          if (valid.length > 0) return valid
        }
      } catch {
        /* ignore */
      }
    }
    // If no profiles exist at all, return empty — don't invent a nonexistent ID
    if (profiles().length === 0) return []
    const currentId = parseInt(localStorage.getItem('currentProfileId') || '1', 10)
    const exists = profiles().some((p) => p.id === currentId)
    return exists ? [currentId] : [profiles()[0].id]
  }

  const [selectedProfileIds, setSelectedProfileIds] =
    createSignal<number[]>(getSelectedProfileIds())

  // Defensive dedup of profiles array before rendering.
  // The store may accumulate duplicates due to proxy/reconciliation edge cases.
  const uniqueProfiles = createMemo(() => {
    const seen = new Set<number>()
    return profiles().filter((p) => {
      if (seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
  })

  const toggleProfileSelection = (profileId: number) => {
    setSelectedProfileIds((prev) => {
      // Dedup in case of stale/corrupted localStorage
      const unique = [...new Set(prev)]
      const idx = unique.indexOf(profileId)
      if (idx !== -1) {
        // Deselect — but keep at least one
        if (unique.length <= 1) return unique
        return unique.filter((id) => id !== profileId)
      }
      return [...unique, profileId]
    })
  }

  const toggleDropdown = () => {
    const wasOpen = state.showDropdown
    if (wasOpen) {
      // Closing dropdown — save and trigger reactive data reload
      const ids = selectedProfileIds()
      localStorage.setItem('selectedProfileIds', JSON.stringify(ids))
      if (ids.length > 0) {
        localStorage.setItem('currentProfileId', ids[0].toString())
      }
      setShowDropdown(false)
      bumpProfileVersion()
      // State is updated via bumpProfileVersion()
    } else {
      setShowDropdown(true)
    }
  }

  const handleLogin = () => {
    // From demo (client-only) mode, "Sign in" means leaving the demo for a real account:
    // switch to server mode and reload into the full login gate (email/password + Google).
    if (!serverMode) {
      setStorageMode('self-hosted')
      window.location.reload()
      return
    }
    setIsLoginModalOpen(true)
  }

  const handleLoginSuccess = async () => {
    setIsLoginModalOpen(false)
    setIsAuthenticated(true)
    void loadBillingPlan()
    await loadProfiles()
    if (profiles().length > 0) {
      const savedProfileId = localStorage.getItem('currentProfileId')
      const selectedProfile = profiles().find(
        (p) => p.id === (savedProfileId ? parseInt(savedProfileId) : null) || p.id === 1
      )
      if (selectedProfile) {
        setCurrentProfile({ ...selectedProfile })
      } else {
        setCurrentProfile({ ...profiles()[0] })
      }
    }
    setShowDropdown(false)
    // Fresh signups land with a pristine profile — offer the setup wizard.
    void maybeOfferOnboarding()
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
    // Client-only mode reloads its local/demo profiles; server mode falls back to the gate.
    if (!serverMode) {
      await loadProfiles(true)
    }
    setShowDropdown(false)
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

    // Password-reset link: <ResetPassword/> takes over the view; skip the profile/category
    // bootstrap below (irrelevant here and would 401 in server mode without a session).
    if (isResetRoute) {
      _setIsLoading(false)
      return
    }

    // Click-outside handler for profile dropdown
    const handleClickOutside = (e: MouseEvent) => {
      if (showDropdown()) {
        const target = e.target as HTMLElement
        if (!target.closest(`.${profileStyles.profileDropdown}`)) {
          // Apply selection and trigger reactive data reload
          const ids = selectedProfileIds()
          localStorage.setItem('selectedProfileIds', JSON.stringify(ids))
          if (ids.length > 0) {
            localStorage.setItem('currentProfileId', ids[0].toString())
          }
          setShowDropdown(false)
          bumpProfileVersion()
          // State is updated via bumpProfileVersion()
        }
      }
    }
    document.addEventListener('click', handleClickOutside)
    onCleanup(() => {
      document.removeEventListener('click', handleClickOutside)
    })

    const loggedIn = await api.checkLogin()
    setIsAuthenticated(loggedIn)
    if (loggedIn) {
      await loadProfiles(true)
      void loadBillingPlan()
    } else if (!serverMode) {
      // Client-only (serverless) mode: no login required — load local/demo profiles.
      await loadProfiles(false)
      if (profiles().length > 0) {
        setCurrentProfile({ ...profiles()[0] })
      }
    }
    // Server mode + no session: the gate renders <LoginScreen/>, so skip the profile and
    // category loads below that would otherwise 401 against the worker.

    // Shared demo link (?demo=high|mid|low): in client-only mode, open that sample
    // income profile. Runs after the branch above regardless of the (demo) "logged
    // in" state, which would otherwise pick a profile from a stale currentProfileId.
    if (!serverMode) {
      const demoTier = getDemoTier()
      const demoProfile = demoTier
        ? profiles().find((p) => p.name === DEMO_PROFILE_NAME[demoTier])
        : undefined
      if (demoProfile) {
        localStorage.setItem('currentProfileId', String(demoProfile.id))
        localStorage.setItem('selectedProfileIds', JSON.stringify([demoProfile.id]))
        setSelectedProfileIds([demoProfile.id])
        setCurrentProfile({ ...demoProfile })
      }
    }

    // Parse initial hash from URL (supports #pagename?param=value)
    const rawHash = window.location.hash.slice(1)
    const hashPage = rawHash.split('?')[0]
    if (hashPage && allPages[hashPage as PageName]) {
      setActivePage(hashPage as PageName)
    } else {
      setActivePage('dashboard')
    }

    // Load categories for Quick Add (skip when the gate will show — avoids a 401).
    if (loggedIn || !serverMode) {
      try {
        const cats = await api.getCategories()
        if (Array.isArray(cats)) setQuickAddCategories(cats as Category[])
      } catch {
        /* non-critical */
      }
    }

    // Command Bar shortcut: Ctrl/Cmd+K (quick entry) or the legacy Ctrl/Cmd+Shift+T.
    const handleQuickAddKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const openK = mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')
      const openT = mod && e.shiftKey && (e.key === 't' || e.key === 'T')
      if (openK || openT) {
        e.preventDefault()
        setIsQuickAddOpen(true)
      }
    }
    document.addEventListener('keydown', handleQuickAddKey)
    onCleanup(() => {
      document.removeEventListener('keydown', handleQuickAddKey)
    })

    // "?" opens the keyboard-shortcuts guide (skipped while typing in a field).
    const handleHelpKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      // Don't stack on top of an already-open modal/menu.
      if (isQuickAddOpen() || isLoginModalOpen() || isProfileModalOpen() || showDropdown()) return
      e.preventDefault()
      setShowShortcuts(true)
    }
    document.addEventListener('keydown', handleHelpKey)
    onCleanup(() => {
      document.removeEventListener('keydown', handleHelpKey)
    })

    // Global period stepping: ←/→ moves the focus period on every page. Guarded so
    // it never fires while typing, while a modal/dropdown is open, or while the
    // PeriodOrbit popup (which owns its own arrow keys) is up.
    const handlePeriodKeys = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (orbitOpen()) return
      if (isQuickAddOpen() || isLoginModalOpen() || isProfileModalOpen() || showDropdown()) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      e.preventDefault()
      stepPeriod(e.key === 'ArrowRight' ? 1 : -1)
    }
    document.addEventListener('keydown', handlePeriodKeys)
    onCleanup(() => {
      document.removeEventListener('keydown', handlePeriodKeys)
    })

    // Mirror the focus period into the URL hash + keep it across page navigation.
    const disposePeriodSync = initPeriodSync()
    onCleanup(disposePeriodSync)

    // Watch for new deployments and reload at a safe moment (next navigation) so a mid-session
    // deploy never strands the user on a deleted chunk.
    const disposeVersionWatch = initVersionWatch()
    onCleanup(disposeVersionWatch)

    _setIsLoading(false)

    // First-run setup: offer the onboarding wizard to pristine profiles (no
    // accounts, no transactions, never seen/skipped it). Runs after the loading
    // gate clears so it never delays app start; the check itself is two GETs.
    if (loggedIn || !serverMode) void maybeOfferOnboarding()
  })

  // Swipe left/right (mobile/tablet) steps the focus period — like 1Money, but the
  // period label sweeps an orbit-arc as it advances. Guarded against vertical scroll
  // intent and against swipes that begin inside a horizontally-scrollable element.
  let swipeX = 0
  let swipeY = 0
  let swipeT = 0
  let swipeGuarded = false
  const startedInScrollable = (target: EventTarget | null): boolean => {
    let el = target as HTMLElement | null
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el)
      const ox = style.overflowX
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 4) return true
      el = el.parentElement
    }
    return false
  }
  const onSwipeStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      swipeGuarded = true
      return
    }
    swipeX = e.touches[0].clientX
    swipeY = e.touches[0].clientY
    swipeT = e.timeStamp
    swipeGuarded = startedInScrollable(e.target)
  }
  const onSwipeEnd = (e: TouchEvent) => {
    if (swipeGuarded) return
    if (orbitOpen() || isQuickAddOpen() || isLoginModalOpen() || isProfileModalOpen()) return
    const t = e.changedTouches[0]
    const dx = t.clientX - swipeX
    const dy = t.clientY - swipeY
    const dt = e.timeStamp - swipeT
    // Clear horizontal intent: long enough, fast enough, and mostly sideways.
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 700) return
    stepPeriod(dx < 0 ? 1 : -1) // swipe left → forward in time, right → back
  }

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

  // Auto-navigate to page required by current spotlight step
  createEffect(() => {
    if (!spotlightActive()) return
    const step = tourSteps()[spotlightStep()]
    if (step?.requiredPage && activePage() !== step.requiredPage) {
      setActivePage(step.requiredPage as PageName)
      window.location.hash = step.requiredPage
    }
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

  // --- Sidebar grouping: collapsible, indented sub-groups with persisted open state ---
  const navByName: Record<string, (typeof navItems)[number]> = {}
  for (const item of navItems) navByName[item.name] = item
  const pick = (...names: string[]) =>
    names.map((n) => navByName[n]).filter((x): x is (typeof navItems)[number] => Boolean(x))
  const navSections: { group?: string; items: (typeof navItems)[number][] }[] = [
    { items: pick('dashboard', 'transactions', 'accounts', 'bills') },
    { group: 'Planning', items: pick('budgets', 'goals', 'loans', 'retirement') },
    { group: 'Calculators', items: pick('compound', 'emergency', 'rentBuy') },
    { group: 'Analytics', items: pick('analytics', 'portfolio') },
    { items: pick('housing', 'counterparties', 'import', 'settings') },
  ]

  const loadOpenGroups = (): Record<string, boolean> => {
    try {
      const raw = localStorage.getItem('sidebarGroupsOpen')
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
    } catch {
      return {}
    }
  }
  const [openGroups, setOpenGroups] = createSignal<Record<string, boolean>>(loadOpenGroups())
  const groupHasActive = (items: (typeof navItems)[number][]) =>
    items.some((it) => it.name === activePage())
  // A group renders expanded when the user hasn't collapsed it (default open) OR it
  // holds the current page (so the active item is always visible even if collapsed).
  const isGroupExpanded = (section: { group?: string; items: (typeof navItems)[number][] }) =>
    (openGroups()[section.group ?? ''] ?? true) || groupHasActive(section.items)
  const toggleGroup = (group: string) => {
    const next = { ...openGroups(), [group]: !(openGroups()[group] ?? true) }
    setOpenGroups(next)
    try {
      localStorage.setItem('sidebarGroupsOpen', JSON.stringify(next))
    } catch {
      /* ignore quota / disabled storage */
    }
  }

  const navLink = (item: (typeof navItems)[number]) => (
    <a
      href={`#${item.name}`}
      data-test-id={`nav-link-${item.name}`}
      class={
        activePage() === item.name ? layoutStyles.sidebarNavActive : layoutStyles.sidebarNavLink
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
  )

  return (
    <Show when={!isResetRoute} fallback={<ResetPassword />}>
      <Show when={!_isLoading()} fallback={<OrbitBootScreen />}>
        <Show when={!serverMode || isAuthenticated()} fallback={<LoginScreen />}>
          <Suspense fallback={<OrbitBootScreen label="Loading…" />}>
            <div
              class={layoutStyles.sidebar}
              classList={{ [layoutStyles.collapsed]: sidebarCollapsed() }}
            >
              <div class={layoutStyles.sidebarLogo}>
                <h1>
                  <LogoMark size={26} />
                  Token Circles
                </h1>
                <p>Your money, in clear orbit</p>
              </div>
              <div class={profileStyles.profileSelector}>
                <div class={profileStyles.profileDropdown}>
                  <button
                    class={profileStyles.profileDropdownBtn}
                    data-test-id="profile-dropdown-btn"
                    onClick={toggleDropdown}
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      'justify-content': 'space-between',
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '8px',
                        'min-width': 0,
                      }}
                    >
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
                          'flex-shrink': 0,
                        }}
                      >
                        {currentProfile()?.name.charAt(0).toUpperCase() || '?'}
                      </div>
                      <span
                        class={profileStyles.profileName}
                        style={{
                          'font-weight': 600,
                          overflow: 'hidden',
                          'text-overflow': 'ellipsis',
                          'white-space': 'nowrap',
                        }}
                      >
                        {selectedProfileIds().length > 1
                          ? profiles()
                              .filter((p) => selectedProfileIds().includes(p.id))
                              .map((p) => p.name)
                              .join(' & ')
                          : currentProfile()?.name || 'Not Logged In'}
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
                    <div class={profileStyles.profileDropdownHeader}>
                      {uniqueProfiles().length === 0
                        ? 'No profiles'
                        : `Profiles (${selectedProfileIds().length} of ${uniqueProfiles().length} selected)`}
                    </div>
                    {uniqueProfiles().length > 0 ? (
                      <For each={uniqueProfiles()}>
                        {(profile) => (
                          <div
                            data-profile-id={profile.id}
                            class={`${profileStyles.profileDropdownItem} ${currentProfile()?.id === profile.id ? profileStyles.active : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedProfileIds().includes(profile.id)}
                              onClick={(e) => {
                                e.stopPropagation()
                              }}
                              onchange={() => {
                                toggleProfileSelection(profile.id)
                              }}
                              style={{
                                width: '16px',
                                height: '16px',
                                'margin-right': '10px',
                                cursor: 'pointer',
                                'accent-color': 'var(--primary)',
                                'flex-shrink': 0,
                              }}
                            />
                            <span
                              style={{ flex: 1, cursor: 'pointer' }}
                              onClick={() => {
                                selectProfile(profile.id)
                              }}
                              title="Set as primary profile"
                            >
                              {profile.name}
                            </span>
                            {currentProfile()?.id === profile.id && (
                              <span
                                style={{
                                  'font-size': '10px',
                                  color: 'var(--primary)',
                                  opacity: 0.7,
                                }}
                              >
                                primary
                              </span>
                            )}
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
                      data-test-id="profile-create-item"
                      onClick={() => {
                        setIsProfileModalOpen(true)
                      }}
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
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '8px',
                      padding: '6px 0',
                    }}
                  >
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
                      {currentProfile()?.name}
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
                <For each={navSections}>
                  {(section) => (
                    <Show
                      when={section.group}
                      fallback={<For each={section.items}>{(item) => navLink(item)}</For>}
                    >
                      <div class={layoutStyles.sidebarGroup}>
                        <button
                          type="button"
                          class={`${layoutStyles.sidebarGroupHeader}${
                            groupHasActive(section.items)
                              ? ` ${layoutStyles.sidebarGroupActive}`
                              : ''
                          }`}
                          aria-expanded={isGroupExpanded(section)}
                          onClick={() => {
                            toggleGroup(section.group!)
                          }}
                        >
                          <span>{section.group}</span>
                          <svg
                            class={`${layoutStyles.sidebarChevron}${
                              isGroupExpanded(section) ? ` ${layoutStyles.sidebarChevronOpen}` : ''
                            }`}
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                          >
                            <path d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        <Show when={isGroupExpanded(section)}>
                          <div class={layoutStyles.sidebarGroupItems}>
                            <For each={section.items}>{(item) => navLink(item)}</For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  )}
                </For>
                <button
                  class={layoutStyles.sidebarNavLink}
                  data-test-id="whats-new-btn"
                  style={{
                    'margin-top': '8px',
                    'border-top': '1px solid rgba(255,255,255,0.08)',
                    'padding-top': '16px',
                  }}
                  onClick={() => {
                    setShowTourSelection(true)
                    setSidebarCollapsed(true)
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.86L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span>What's New</span>
                </button>
              </nav>
            </div>

            <Show when={!sidebarCollapsed()}>
              <div
                class={layoutStyles['sidebar-overlay']}
                onClick={() => {
                  setSidebarCollapsed(true)
                }}
              />
            </Show>

            <button
              class={layoutStyles['mobile-toggle']}
              classList={{ [layoutStyles['mobile-toggle-open']]: !sidebarCollapsed() }}
              onClick={() => {
                setSidebarCollapsedStore(!state.sidebarCollapsed)
              }}
              aria-label="Toggle sidebar"
            >
              {/* Closed: hamburger at top-left. Open: back-chevron parked at the sidebar's
                  top-right so it never covers the logo. */}
              <svg
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path d={sidebarCollapsed() ? 'M4 6h16M4 12h16M4 18h16' : 'M15 19l-7-7 7-7'} />
              </svg>
            </button>

            <main class={layoutStyles.main} onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
              {Object.entries(allPages).map(([name, page]) => (
                <Show when={mountedPages().has(name)}>
                  <div style={{ display: activePage() === name ? 'block' : 'none' }}>
                    <Suspense fallback={<div class={layoutStyles.pageLoader}>Loading...</div>}>
                      <ErrorBoundary
                        fallback={(err) => (
                          <div class={layoutStyles.pageError}>
                            <h3>Page Error</h3>
                            <p>{err.toString()}</p>
                            <button
                              onClick={() => {
                                window.location.reload()
                              }}
                            >
                              Reload
                            </button>
                          </div>
                        )}
                      >
                        <Dynamic component={page} data-testid={`page-${name}`} />
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                </Show>
              ))}
            </main>

            <Show when={isLoginModalOpen()}>
              <LoginModal
                onClose={() => {
                  setIsLoginModalOpen(false)
                }}
                onSuccess={handleLoginSuccess}
              />
            </Show>

            <Show when={isProfileModalOpen()}>
              <ProfileModal
                onClose={() => {
                  setIsProfileModalOpen(false)
                }}
                onSuccess={() => {
                  setIsProfileModalOpen(false)
                  loadProfiles(true)
                }}
              />
            </Show>

            <CommandBar
              isOpen={isQuickAddOpen}
              onClose={() => {
                setIsQuickAddOpen(false)
              }}
              categories={() => quickAddCategories()}
              onSave={() => {
                toast('Entry added', 'success')
                bumpProfileVersion()
              }}
            />

            {/* Floating quick-add — the universal way in (works on touch, where
                the ⌘K command bar has no shortcut). Opens the Guided Orbit. */}
            <button
              class={layoutStyles.fab}
              onClick={() => setIsGuidedOpen(true)}
              aria-label="Quick add entry"
              title="Quick add (or ⌘K for the command bar)"
            >
              <svg
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" d="M12 5v14M5 12h14" />
              </svg>
            </button>

            <GuidedOrbit
              isOpen={isGuidedOpen}
              onClose={() => setIsGuidedOpen(false)}
              categories={() => quickAddCategories()}
              onSave={() => {
                toast('Entry added', 'success')
                bumpProfileVersion()
              }}
            />

            <Show when={spotlightActive()}>
              <Spotlight />
            </Show>

            <Show when={showShortcuts()}>
              <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
            </Show>

            <Show when={showTourSelection()}>
              <TourSelectionModal />
            </Show>

            <Show when={onboardingOpen()}>
              <OnboardingWizard />
            </Show>

            <ToastContainer />
            <ConfirmDialog />
          </Suspense>
        </Show>
      </Show>
    </Show>
  )
}
