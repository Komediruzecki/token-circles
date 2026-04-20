/**
 * Main App Component - Root component for the application
 */

import { createSignal, onMount } from 'solid-js'
import { api, escapeHtml } from './core/api.js'
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

type PageName =
  | 'dashboard'
  | 'transactions'
  | 'budgets'
  | 'loans'
  | 'goals'
  | 'bills'
  | 'import'
  | 'accounts'
  | 'categories'
  | 'settings'
  | 'retirement'
  | 'housing'
  | 'analytics'

type PageComponent =
  | typeof Dashboard
  | typeof Transactions
  | typeof Budgets
  | typeof Loans
  | typeof Goals
  | typeof Bills
  | typeof Import
  | typeof Accounts
  | typeof Categories
  | typeof Settings
  | typeof Retirement
  | typeof Housing
  | typeof Analytics

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

// Receipt handlers exported to window for event delegation
window.receipts = {
  handleFileSelect: (event: Event) => {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]

    if (!file) return

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB')
      target.value = ''
      return
    }

    // Create preview URL for images
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      const preview = document.getElementById('receipt-thumbnail') as HTMLImageElement
      const placeholder = document.getElementById('receipt-placeholder') as HTMLElement
      const actions = document.getElementById('receipt-actions') as HTMLElement

      if (preview) {
        preview.src = url
        preview.style.display = 'block'
      }
      if (placeholder) {
        placeholder.style.display = 'none'
      }
      if (actions) {
        actions.style.display = 'flex'
      }
    }
  },
  removeReceipt: () => {
    const receiptInput = document.getElementById('tx-receipt') as HTMLInputElement
    const preview = document.getElementById('receipt-thumbnail') as HTMLImageElement
    const placeholder = document.getElementById('receipt-placeholder') as HTMLElement
    const actions = document.getElementById('receipt-actions') as HTMLElement

    if (receiptInput) {
      receiptInput.value = ''
    }
    if (preview) {
      preview.src = ''
      preview.style.display = 'none'
    }
    if (placeholder) {
      placeholder.style.display = 'flex'
    }
    if (actions) {
      actions.style.display = 'none'
    }
  },
  delete: async (receiptId: number) => {
    try {
      await api.deleteReceipt(receiptId)
      const modal = document.getElementById('receipt-modal') as HTMLElement
      if (modal) {
        modal.classList.remove('show')
      }
      toast('Receipt deleted', 'success')
    } catch (error) {
      console.error('Failed to delete receipt:', error)
      toast('Failed to delete receipt', 'error')
    }
  },
}

// Transactions handlers exported to window
window.transactions = {
  handleReceiptFileSelect: (event: Event) => {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]

    if (!file) return

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB')
      target.value = ''
      return
    }

    // Create preview URL for images
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      const preview = document.getElementById('receipt-thumbnail') as HTMLImageElement
      const placeholder = document.getElementById('receipt-placeholder') as HTMLElement
      const actions = document.getElementById('receipt-actions') as HTMLElement

      if (preview) {
        preview.src = url
        preview.style.display = 'block'
      }
      if (placeholder) {
        placeholder.style.display = 'none'
      }
      if (actions) {
        actions.style.display = 'flex'
      }
    }
  },
  removeReceipt: () => {
    const receiptInput = document.getElementById('tx-receipt') as HTMLInputElement
    const preview = document.getElementById('receipt-thumbnail') as HTMLImageElement
    const placeholder = document.getElementById('receipt-placeholder') as HTMLElement
    const actions = document.getElementById('receipt-actions') as HTMLElement

    if (receiptInput) {
      receiptInput.value = ''
    }
    if (preview) {
      preview.src = ''
      preview.style.display = 'none'
    }
    if (placeholder) {
      placeholder.style.display = 'flex'
    }
    if (actions) {
      actions.style.display = 'none'
    }
  },
  openModal: () => {
    const modal = document.getElementById('tx-modal') as HTMLElement
    const title = document.getElementById('tx-modal-title') as HTMLElement
    if (modal) {
      modal.classList.add('show')
    }
    if (title) {
      title.textContent = 'Add Transaction'
    }
  },
  openEditModal: (transactionId: number) => {
    // Load transaction data and populate modal
    api.getTransactions().then(transactions => {
      const tx = transactions.find(t => t.id === transactionId)
      if (!tx) return

      const modal = document.getElementById('tx-modal') as HTMLElement
      const title = document.getElementById('tx-modal-title') as HTMLElement
      const descInput = document.getElementById('tx-description') as HTMLInputElement
      const amountInput = document.getElementById('tx-amount') as HTMLInputElement
      const dateInput = document.getElementById('tx-date') as HTMLInputElement
      const categoryInput = document.getElementById('tx-category') as HTMLSelectElement
      const meansInput = document.getElementById('tx-means') as HTMLSelectElement
      const notesInput = document.getElementById('tx-notes') as HTMLInputElement
      const receiptInput = document.getElementById('tx-receipt') as HTMLInputElement
      const idInput = document.getElementById('tx-id') as HTMLInputElement
      const typeSelector = document.getElementById('tx-type-selector') as HTMLElement

      if (!modal || !title || !descInput || !amountInput || !dateInput || !categoryInput || !typeSelector) return

      title.textContent = 'Edit Transaction'
      idInput.value = tx.id.toString()
      descInput.value = tx.description
      amountInput.value = tx.amount.toString()
      dateInput.value = tx.date

      // Set category
      Array.from(categoryInput.options).forEach(opt => {
        opt.selected = opt.value === tx.category_name
      })

      // Set type
      const typeButtons = typeSelector.querySelectorAll('button')
      typeButtons.forEach(btn => {
        btn.classList.remove('active')
        if (btn.dataset.selectedType === tx.type) {
          btn.classList.add('active')
        }
      })

      if (meansInput) meansInput.value = (tx.beneficiary || tx.payor || '')
      if (notesInput) notesInput.value = ''
      if (receiptInput) receiptInput.value = ''

      modal.classList.add('show')
    })
  },
  closeModal: () => {
    const modal = document.getElementById('tx-modal') as HTMLElement
    if (modal) {
      modal.classList.remove('show')
    }
  },
}

// Modal arg handlers for dynamic modals (using data-arg)
window.handlers = {
  'receipt-modal': (arg: any) => {
    if (arg && typeof arg === 'object') {
      // Open receipt modal with receipt data
      const modal = document.getElementById('receipt-modal') as HTMLElement
      const img = document.getElementById('receipt-view-image') as HTMLImageElement
      const meta = document.getElementById('receipt-meta') as HTMLElement
      const downloadLink = document.getElementById('receipt-download-link') as HTMLAnchorElement

      if (modal && img && meta && arg.id) {
        // Set image src
        img.src = `/api/receipts/${arg.id}/file`

        // Populate meta info
        meta.innerHTML = `
          <div class="receipt-meta-item">
            <span class="receipt-meta-label">File Name</span>
            <span>${escapeHtml(arg.original_name)}</span>
          </div>
          <div class="receipt-meta-item">
            <span class="receipt-meta-label">File Type</span>
            <span>${escapeHtml(arg.file_type)}</span>
          </div>
          <div class="receipt-meta-item">
            <span class="receipt-meta-label">Size</span>
            <span>${(arg.file_size / 1024).toFixed(2)} KB</span>
          </div>
          <div class="receipt-meta-item">
            <span class="receipt-meta-label">Uploaded</span>
            <span>${new Date(arg.uploaded_at).toLocaleString()}</span>
          </div>
        `

        // Set download link
        if (downloadLink) {
          downloadLink.href = `/api/receipts/${arg.id}/file`
          downloadLink.download = arg.original_name
        }

        modal.classList.add('show')
      }
    }
  },
}

export default function App() {
  const [currentPage, setCurrentPage] = createSignal<PageName>('dashboard')

  // Currency exchange rate cache
  const exchangeRates = new Map<string, { rate: number; timestamp: number }>()

  onMount(() => {
    theme.init()

    // Add keyboard navigation to sidebar
    const setupKeyboardNavigation = () => {
      const navLinks = document.querySelectorAll('.sidebar-nav a[data-page], .nav-links a[data-page]')
      const firstLink = navLinks[0] as HTMLElement
      const lastLink = navLinks[navLinks.length - 1] as HTMLElement

      // Add tabindex for keyboard navigation
      navLinks.forEach(link => {
        link.setAttribute('tabindex', '0')
        link.setAttribute('role', 'link')
      })

      navLinks.forEach(link => {
        link.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            link.click()
          }
        })
      })

      // Handle Tab navigation between sidebar and nav
      navLinks.forEach((link, index) => {
        link.addEventListener('keydown', (event) => {
          if (event.key === 'Tab') {
            if (event.shiftKey && index === 0) {
              event.preventDefault()
              lastLink?.focus()
            } else if (!event.shiftKey && index === navLinks.length - 1) {
              event.preventDefault()
              firstLink?.focus()
            }
          }
        })
      })
    }

    setupKeyboardNavigation()

    // Keyboard navigation shortcuts
    const handleKeyboardShortcuts = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs or textareas
      if (event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement) {
        // Allow Escape to close modals even when typing
        if (event.key === 'Escape') {
          const closeBtn = document.querySelector('.modal-close')
          closeBtn?.click()
        }
        return
      }

      // Ctrl/Cmd + K: Open quick search (placeholder for future)
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault()
        toast('Quick search coming soon', 'info')
      }

      // Ctrl/Cmd + B: Toggle sidebar (mobile)
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault()
        const sidebar = document.getElementById('sidebar')
        const overlay = document.getElementById('mobile-overlay')
        if (sidebar && overlay) {
          const isOpen = sidebar.classList.contains('collapsed')
          if (isOpen) {
            sidebar.classList.remove('collapsed')
            overlay.classList.remove('show')
          } else {
            sidebar.classList.add('collapsed')
            overlay.classList.add('show')
          }
        }
      }

      // Escape: Close modals
      if (event.key === 'Escape') {
        const closeBtn = document.querySelector('.modal-close')
        const modalOverlays = document.querySelectorAll('.modal-overlay')
        modalOverlays.forEach(overlay => {
          if (overlay.style.display !== 'none') {
            closeBtn?.click()
          }
        })
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcuts)

    // Currency conversion functions for transaction modal
    const handleCurrencyChange = (event: Event) => {
      const target = event.target as HTMLSelectElement
      const rate = parseFloat(target.value) || 1

      const amountInput = document.getElementById('tx-amount') as HTMLInputElement
      const localAmountInput = document.getElementById('tx-amount-local') as HTMLInputElement

      if (!amountInput || !localAmountInput) return

      const amount = parseFloat(amountInput.value) || 0
      localAmountInput.value = (amount * rate).toFixed(2)
    }

    const handleLocalAmountChange = (event: Event) => {
      const target = event.target as HTMLInputElement
      const rate = parseFloat(target.value) || 1

      const amountInput = document.getElementById('tx-amount') as HTMLInputElement
      const currencySelect = document.getElementById('tx-currency') as HTMLSelectElement

      if (!amountInput) return

      const amount = parseFloat(amountInput.value) || 0
      const targetCurrency = currencySelect ? currencySelect.value : 'USD'
      localAmountInput.value = (amount / rate).toFixed(2)
    }

    const handleExchangeRateChange = (event: Event) => {
      const target = event.target as HTMLInputElement
      const rate = parseFloat(target.value) || 1

      const amountInput = document.getElementById('tx-amount') as HTMLInputElement
      const localAmountInput = document.getElementById('tx-amount-local') as HTMLInputElement

      if (!amountInput || !localAmountInput) return

      const amount = parseFloat(amountInput.value) || 0
      localAmountInput.value = (amount * rate).toFixed(2)
    }

    const setupTransactionModalListeners = () => {
      const currencySelect = document.getElementById('tx-currency') as HTMLSelectElement
      const localAmountInput = document.getElementById('tx-amount-local') as HTMLInputElement
      const exchangeRateInput = document.getElementById('tx-exchange-rate') as HTMLInputElement

      if (currencySelect) {
        currencySelect.addEventListener('change', handleCurrencyChange)
      }
      if (localAmountInput) {
        localAmountInput.addEventListener('input', handleLocalAmountChange)
      }
      if (exchangeRateInput) {
        exchangeRateInput.addEventListener('input', handleExchangeRateChange)
      }
    }

    // Receipt event handlers - already exported to window.receipts
    const handleTransactionSave = async () => {
      const formData = new FormData()
      const idInput = document.getElementById('tx-id') as HTMLInputElement
      const descInput = document.getElementById('tx-description') as HTMLInputElement
      const amountInput = document.getElementById('tx-amount') as HTMLInputElement
      const dateInput = document.getElementById('tx-date') as HTMLInputElement
      const typeSelector = document.getElementById('tx-type-selector') as HTMLElement
      const categoryInput = document.getElementById('tx-category') as HTMLSelectElement
      const meansInput = document.getElementById('tx-means') as HTMLSelectElement
      const notesInput = document.getElementById('tx-notes') as HTMLTextAreaElement
      const receiptInput = document.getElementById('tx-receipt') as HTMLInputElement

      if (!descInput || !amountInput || !dateInput || !categoryInput || !typeSelector) return

      const desc = descInput.value.trim()
      const amount = parseFloat(amountInput.value)
      const date = dateInput.value
      const category = parseInt(categoryInput.value)
      const type = typeSelector.dataset.selectedType || 'expense'

      if (!desc || amount <= 0 || !date || !category) {
        alert('Please fill in all required fields')
        return
      }

      try {
        if (idInput.value) {
          await api.updateTransaction(parseInt(idInput.value), {
            description: desc,
            amount: amount,
            date: date,
            category_id: category,
            type: type,
            means: meansInput.value || undefined,
            notes: notesInput.value || undefined,
          })
        } else {
          await api.createTransaction({
            description: desc,
            amount: amount,
            date: date,
            category_id: category,
            type: type,
            means: meansInput.value || undefined,
            notes: notesInput.value || undefined,
          })
        }

        // Handle receipt upload
        const txId = idInput.value ? parseInt(idInput.value) : null
        if (txId && receiptInput.files?.[0]) {
          await api.uploadReceipt(txId, receiptInput.files[0])
        }

        closeAllModals()
        loadTransactions()
      } catch (error) {
        console.error('Failed to save transaction:', error)
        alert('Failed to save transaction. Please try again.')
      }
    }

    const loadTransactions = async () => {
      try {
        setLoading(true)
        const data = await api.getTransactions()
        setTransactions(data)
      } catch (error) {
        console.error('Failed to load transactions:', error)
      } finally {
        setLoading(false)
      }
    }

    const openReceiptModal = (receipt: any) => {
      // This would be populated when the Transactions component is fully implemented
      console.log('Opening receipt modal for:', receipt)
    }

    const deleteReceipt = async (receiptId: number) => {
      try {
        await api.deleteReceipt(receiptId)
        loadTransactions()
      } catch (error) {
        console.error('Failed to delete receipt:', error)
        alert('Failed to delete receipt')
      }
    }

    const downloadReceipt = async (receiptId: number) => {
      try {
        const blob = await api.getReceiptFile(receiptId)
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = receipt.original_name
        link.click()
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error('Failed to download receipt:', error)
        alert('Failed to download receipt')
      }
    }

    const setLoading = (loading: boolean) => {
      // Would update loading state in Transactions component
    }

    const setTransactions = (transactions: any[]) => {
      // Would update transactions in Transactions component
    }

    const loadTransactionReceipt = async () => {
      // Load receipt logic for view modal
    }

    const closeAllModals = () => {
      const modal = document.getElementById('tx-modal') as HTMLElement
      const modal2 = document.getElementById('quickadd-modal') as HTMLElement
      if (modal) modal.classList.remove('show')
      if (modal2) modal2.classList.remove('show')
    }

    // Setup mutation observer to catch dynamically added modals
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.id === 'transaction-modal') {
            setupTransactionModalListeners()
          }
        })
      })
    })

    observer.observe(document.getElementById('modals') || document.body, {
      childList: true,
      subtree: true
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
        <div id="page-content" class="page">
          <div class="page-inner">
            <div class="page-content">
              {(() => {
                const page = currentPage()
                return <div>{pages[page]()}</div>
              })()}
            </div>
          </div>
        </div>
      </main>

      {/* Modals */}
      <div id="modals" />

      {/* Toasts */}
      <div id="toast-container" />

      {/* Mobile Sidebar */}
      <div id="mobile-overlay" class="mobile-overlay" />
      <aside id="sidebar" class="sidebar">
        <div class="sidebar-header">
          <h2>Menu</h2>
          <button id="sidebar-close" class="sidebar-close">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
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
  )
}
