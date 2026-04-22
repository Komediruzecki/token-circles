/**
 * Main App Component - Root component for the application
 */

import { createSignal, onMount } from 'solid-js'
import { theme } from './core/theme.js'
import Accounts from './features/Accounts'
import Analytics from './features/Analytics'
import Bills from './features/Bills'
import Budgets from './features/Budgets'
import Categories from './features/Categories'
import Dashboard from './features/Dashboard'
import Goals from './features/Goals'
import Housing from './features/Housing'
import Import from './features/Import'
import Loans from './features/Loans'
import Retirement from './features/Retirement'
import Settings from './features/Settings'
import Transactions from './features/Transactions'
import type { PageName, PageComponent } from './types/models.js'
import { receipts, transactions, handlers, handleReceiptFileSelect, handleModalAction } from './core/handlers.js'

const pages: Record<PageName, PageComponent> = {
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
}

// Mount handlers to window for legacy code compatibility
window.receipts = receipts
window.transactions = transactions
window.handlers = handlers

export function App() {
  const [currentPage, setCurrentPage] = createSignal<PageName>('dashboard')

  // Currency exchange rate cache - unused, keeping for future feature
  // @ts-expect-error - unused, keeping for future feature
  const _exchangeRates = new Map<string, { rate: number; timestamp: number }>()

  onMount(() => {
    theme.init()

    // Add keyboard navigation to sidebar
    const setupKeyboardNavigation = () => {
      const navLinks = document.querySelectorAll(
        '.sidebar-nav a[data-page], .nav-links a[data-page]'
      )
      const firstLink = navLinks[0] as HTMLElement
      const lastLink = navLinks[navLinks.length - 1] as HTMLElement

      // Add tabindex for keyboard navigation
      navLinks.forEach((link) => {
        link.setAttribute('tabindex', '0')
        link.setAttribute('role', 'link')
      })

      navLinks.forEach((link) => {
        const currentLink = link as HTMLElement
        currentLink.addEventListener('keydown', (e: Event) => {
          const key = (e as KeyboardEvent).key
          if (key === 'ArrowDown' || key === 'ArrowRight') {
            const currentIndex = Array.from(navLinks).indexOf(currentLink)
            const nextIndex = Math.min(currentIndex + 1, navLinks.length - 1)
            if (nextIndex !== currentIndex) {
              const nextLink = navLinks[nextIndex] as HTMLElement
              nextLink.focus()
            }
          } else if (key === 'ArrowUp' || key === 'ArrowLeft') {
            const currentIndex = Array.from(navLinks).indexOf(currentLink)
            const prevIndex = Math.max(currentIndex - 1, 0)
            if (prevIndex !== currentIndex) {
              const prevLink = navLinks[prevIndex] as HTMLElement
              prevLink.focus()
            }
          } else if (key === 'Enter' || key === ' ') {
            ;(e as KeyboardEvent).preventDefault()
            currentLink.click()
          }
        })
      })

      if (firstLink && lastLink) {
        firstLink.setAttribute('tabindex', '0')
        firstLink.addEventListener('keydown', (e: Event) => {
          if ((e as KeyboardEvent).key === 'ArrowUp') {
            ;(e as KeyboardEvent).preventDefault()
            lastLink.focus()
          }
        })

        lastLink.setAttribute('tabindex', '0')
        lastLink.addEventListener('keydown', (e: Event) => {
          if ((e as KeyboardEvent).key === 'ArrowDown') {
            ;(e as KeyboardEvent).preventDefault()
            firstLink.focus()
          }
        })
      }
    }

    setupKeyboardNavigation()

    // Handle modal clicks for closing
    document.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement
      const clickHandler = target.closest('[data-action]') as HTMLElement
      if (!clickHandler) return
      const action = clickHandler.dataset.action
      if (action === 'modal:close') {
        const modal = document.getElementById('tx-modal') as HTMLElement
        if (modal) {
          modal.classList.remove('show')
        }
      }
    })

    // Handle file input change
    document.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement
      const changeHandler = target.closest('[data-action]') as HTMLElement
      if (!changeHandler) return
      const action = changeHandler.dataset.action
      if (action === 'transaction:receiptFile') {
        if (target.id === 'tx-receipt' && window.receipts) {
          window.receipts.handleFileSelect(e)
        }
      }
    })

    // Handle hash changes for routing
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) || 'dashboard'
      const page = hash as PageName
      if (page in pages) {
        setCurrentPage(page)
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    handleHashChange()
  })

  return (
    <div class="app">
      {/* Header */}
      <header class="app-header">
        <div class="header-left">
          <h1 class="app-title">
            <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Finance Manager
          </h1>
        </div>
        <div class="header-right">
          <button class="btn-icon" data-action="app:settings" aria-label="Settings">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </header>

      <div class="app-body">
        {/* Sidebar */}
        <aside class="sidebar">
          <nav class="sidebar-nav">
            <a
              class={`sidebar-link ${currentPage() === 'dashboard' ? 'active' : ''}`}
              href="#dashboard"
              data-page="dashboard"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              Dashboard
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'transactions' ? 'active' : ''}`}
              href="#transactions"
              data-page="transactions"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
              Transactions
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'accounts' ? 'active' : ''}`}
              href="#accounts"
              data-page="accounts"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                />
              </svg>
              Accounts
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'categories' ? 'active' : ''}`}
              href="#categories"
              data-page="categories"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
              Categories
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'budgets' ? 'active' : ''}`}
              href="#budgets"
              data-page="budgets"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                />
              </svg>
              Budgets
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'goals' ? 'active' : ''}`}
              href="#goals"
              data-page="goals"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              Goals
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'loans' ? 'active' : ''}`}
              href="#loans"
              data-page="loans"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              Loans
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'bills' ? 'active' : ''}`}
              href="#bills"
              data-page="bills"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
              Bills
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'retirement' ? 'active' : ''}`}
              href="#retirement"
              data-page="retirement"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Retirement
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'housing' ? 'active' : ''}`}
              href="#housing"
              data-page="housing"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              Housing
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'analytics' ? 'active' : ''}`}
              href="#analytics"
              data-page="analytics"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              Analytics
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'import' ? 'active' : ''}`}
              href="#import"
              data-page="import"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
              Import
            </a>
            <a
              class={`sidebar-link ${currentPage() === 'settings' ? 'active' : ''}`}
              href="#settings"
              data-page="settings"
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Settings
            </a>
          </nav>
        </aside>

        {/* Main Content */}
        <main class="main-content">
          <div id="page-content">{pages[currentPage()]}</div>
        </main>
      </div>
    </div>
  )
}

