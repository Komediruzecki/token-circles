/**
 * Transactions Component - EARS Specification
 *
 * GIVEN: A user is viewing the Transactions page
 * WHEN: The page loads
 * THEN: The header displays "Transactions" and filters/controls are visible
 *
 * GIVEN: A user wants to add a transaction
 * WHEN: They click the "Add Transaction" button
 * THEN: An "Add Transaction" modal opens with form fields for all transaction details
 *
 * GIVEN: A user is viewing transactions with reconciled items
 * WHEN: They click a checkbox to toggle reconciliation status
 * THEN: The row highlights and reconciliation state updates
 *
 * GIVEN: A user has uploaded a receipt image
 * WHEN: They view a transaction with a receipt
 * THEN: A receipt icon displays, clicking it opens the receipt image in a modal
 *
 * GIVEN: A user wants to edit a transaction
 * WHEN: They click the edit button on a transaction row
 * THEN: The "Add Transaction" modal populates with existing transaction data
 *
 * GIVEN: A user wants to delete a transaction
 * WHEN: They select a transaction and delete it
 * THEN: The transaction is removed from the list with a confirmation message
 */

/**
 * Transactions Component
 * Handles transaction listing, creation, and management with filtering, sorting, and pagination
 */
import { createEffect, createMemo, createSignal, For, onMount } from 'solid-js'
import AutoCategorizeModal from '../components/AutoCategorizeModal'
import BulkActionBar from '../components/BulkActionBar'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'
import ReconciliationModal from '../components/ReconciliationModal'
import RecurringSection from '../components/RecurringSection'
import TransactionSummaryBar from '../components/TransactionSummaryBar'
import TransactionTable from '../components/TransactionTable'
import { api, getLocalCurrency, toast } from '../core/api'
import { apiPut } from '../core/api'
import { useAppState } from '../core/appStore'
import { showConfirm } from '../core/confirmStore'
import { txBaseValue } from '../core/currency'
import styles from './TransactionsPage.module.css'
import type { Category, Receipt, Transaction, TransactionType } from '../types/models'

export default function Transactions() {
  const state = useAppState()
  const [transactions, setTransactions] = createSignal<Transaction[]>([])
  const [loading, setLoading] = createSignal(true)
  const [selectedTransactions, setSelectedTransactions] = createSignal<number[]>([])
  const [selectedReceipt, setSelectedReceipt] = createSignal<Receipt | null>(null)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = createSignal(false)
  const [isTransactionModalOpen, setTransactionModalOpen] = createSignal(false)
  const [isAutoCategorizeModalOpen, setAutoCategorizeModalOpen] = createSignal(false)
  const [isReconciliationModalOpen, setReconciliationModalOpen] = createSignal(false)
  const [selectedFile, setSelectedFile] = createSignal<File | null>(null)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = createSignal<string | null>(null)
  // Receipt already attached to the transaction being edited (shown in the edit modal).
  const [existingReceipt, setExistingReceipt] = createSignal<Receipt | null>(null)
  const [formId, setFormId] = createSignal<string | null>(null)
  const [type, setType] = createSignal<TransactionType>('expense')
  const [formDate, setFormDate] = createSignal(new Date().toISOString().slice(0, 10))
  const [formAmount, setFormAmount] = createSignal('')
  const [formCurrency, setFormCurrency] = createSignal(getLocalCurrency())
  const [formExchangeRate, setFormExchangeRate] = createSignal('1')
  const [formCategory, setFormCategory] = createSignal<number | null>(null)
  const [formBeneficiary, setFormBeneficiary] = createSignal('')
  const [formPayor, setFormPayor] = createSignal('')
  const [formNotes, setFormNotes] = createSignal('')
  const [formDescription, setFormDescription] = createSignal('')
  const [formMeans, setFormMeans] = createSignal('')
  const [formAccountId, setFormAccountId] = createSignal<number | null>(null)
  const [formAmountLocal, setFormAmountLocal] = createSignal('')
  const [accounts, setAccounts] = createSignal<Array<{ id: number; name: string; type: string }>>(
    []
  )
  const [categories, setCategories] = createSignal<Category[]>([])
  // Filter categories by the selected transaction type
  const filteredCategories = createMemo(() => {
    const t = type()
    const cats = categories()
    if (t === 'transfer') return []
    return cats.filter((c) => c.type === t)
  })
  const [tags, setTags] = createSignal<Array<{ id: number; name: string; color: string }>>([])
  const [selectedCategories, setSelectedCategories] = createSignal<number[]>([])
  const [selectedTags, setSelectedTags] = createSignal<number[]>([])
  const [dateRange, setDateRange] = createSignal<{ from: string; to: string }>({ from: '', to: '' })
  const [selectedPreset, setSelectedPreset] = createSignal<string>('')
  const [currentPage, setCurrentPage] = createSignal(1)
  const [itemsPerPage] = createSignal(50)
  const [sortField, setSortField] = createSignal<string>('date')
  const [sortOrder, setSortOrder] = createSignal<'asc' | 'desc'>('desc')
  const [filterType, setFilterType] = createSignal<string>('all')
  const [filterMonth, _setFilterMonth] = createSignal<string | null>(null)
  const [searchTerm, setSearchTerm] = createSignal<string>('')
  const [totalIncome, setTotalIncome] = createSignal(0)
  const [totalExpenses, setTotalExpenses] = createSignal(0)
  const [netBalance, setNetBalance] = createSignal(0)
  const [totalAmount, setTotalAmount] = createSignal(0)
  const [showReconciled, setShowReconciled] = createSignal(true)

  // Reload when profile selection changes
  createEffect(() => {
    void state.profileVersion
    refreshTransactions()
  })

  // Calculate filtered-period totals (respects all active filters). Sum the
  // base-currency value so mixed-currency rows add up correctly (not raw amount).
  createEffect(() => {
    const txs = filteredTransactions()
    const income = txs
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + Math.abs(txBaseValue(t)), 0)
    const expenses = txs
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(txBaseValue(t)), 0)
    const total = txs.reduce((sum, t) => sum + Math.abs(txBaseValue(t)), 0)
    setTotalIncome(income)
    setTotalExpenses(expenses)
    setNetBalance(income - expenses)
    setTotalAmount(total)
  })

  // Period label for summary context
  const periodLabel = createMemo(() => {
    if (selectedPreset() === 'all' || (!dateRange().from && !dateRange().to)) return 'All Time'
    if (selectedPreset() === 'month' || filterMonth()) return 'This Month'
    if (selectedPreset() === 'lastMonth') return 'Last Month'
    if (selectedPreset() === 'year') return 'This Year'
    if (dateRange().from && dateRange().to) return `${dateRange().from} – ${dateRange().to}`
    return 'Filtered Period'
  })

  // Revoke a blob: object URL (no-op for data/file URLs from the picker preview)
  const revokePreviewUrl = () => {
    const url = receiptPreviewUrl()
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    setReceiptPreviewUrl(null)
  }

  // Fetch the receipt file through the API client (cookie-authenticated, API_BASE-aware)
  // and expose it as an object URL — a plain <img src="/api/..."> would miss both on
  // deployed builds where the API lives on another origin.
  const loadReceiptBlobUrl = async (receiptId: number): Promise<string> => {
    const blob = await api.getReceiptFile(receiptId)
    return URL.createObjectURL(blob)
  }

  // Open the receipt view modal for a transaction (from the table's receipt chip)
  const openReceiptForTransaction = async (transaction: Transaction) => {
    if (typeof transaction.receipt_id !== 'number') return
    try {
      const receipt = (await api.getReceipt(transaction.receipt_id)) as Receipt
      const url = await loadReceiptBlobUrl(receipt.id)
      setSelectedReceipt(receipt)
      setReceiptPreviewUrl(url)
      setIsReceiptModalOpen(true)
    } catch (error) {
      console.error('Failed to load receipt:', error)
      toast('Failed to load receipt', 'error')
    }
  }

  /**
   * Handle receipt file selection
   */
  const _handleReceiptFileSelect = (_event: Event): void => {
    const target = _event.target as HTMLInputElement
    const file = target.files?.[0]

    if (!file) return

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast('File size must be less than 5MB', 'warning')
      target.value = ''
      return
    }

    setSelectedFile(file)
    setExistingReceipt(null)
    revokePreviewUrl()
    setReceiptPreviewUrl(URL.createObjectURL(file))
  }

  // Close all modals
  const _closeModals = () => {
    setTransactionModalOpen(false)
  }

  // Close receipt modal
  const closeReceiptModal = () => {
    setIsReceiptModalOpen(false)
    revokePreviewUrl()
    setSelectedReceipt(null)
  }

  // Delete receipt
  const deleteReceipt = async () => {
    const receipt = selectedReceipt()
    if (!receipt) return
    if (!(await showConfirm(`Delete receipt "${receipt.original_name}"?`))) return

    try {
      await api.deleteReceipt(receipt.id)
      closeReceiptModal()
      // Reload transactions to remove the deleted receipt chip
      await refreshTransactions()
    } catch (error) {
      console.error('Failed to delete receipt:', error)
      toast('Failed to delete receipt', 'error')
    }
  }

  // Handle selection changes
  const handleSelectionChange = (ids: number[]) => {
    setSelectedTransactions(ids)
  }

  // Handle sort changes
  const handleSortChange = (field: string) => {
    if (sortField() === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const handleDeleteTransaction = async (transaction: Transaction) => {
    if (!(await showConfirm(`Delete transaction "${transaction.description}"?`))) return
    try {
      await api.deleteTransaction(transaction.id)
      await refreshTransactions()
    } catch (error) {
      console.error('Failed to delete transaction:', error)
    }
  }

  const handleBulkDelete = async () => {
    const ids = selectedTransactions()
    if (ids.length === 0) return
    if (
      !(await showConfirm(
        `Delete ${ids.length} selected transaction${ids.length !== 1 ? 's' : ''}?`
      ))
    )
      return
    try {
      for (const id of ids) {
        await api.deleteTransaction(id)
      }
      setSelectedTransactions([])
      await refreshTransactions()
    } catch (error) {
      console.error('Failed to bulk delete transactions:', error)
    }
  }

  const handleBulkReconcile = () => {
    setReconciliationModalOpen(true)
  }

  const handleBulkChangeCategory = async (categoryId: number | null) => {
    const ids = selectedTransactions()
    if (ids.length === 0) return
    try {
      await apiPut('/api/transactions/bulk', {
        ids,
        action: 'update',
        data: { category_id: categoryId },
      })
      setSelectedTransactions([])
      await refreshTransactions()
    } catch (error) {
      console.error('Failed to bulk change category:', error)
    }
  }

  const handleBulkChangeType = async (type: string) => {
    const ids = selectedTransactions()
    if (ids.length === 0) return
    try {
      await apiPut('/api/transactions/bulk', { ids, action: 'update', data: { type } })
      setSelectedTransactions([])
      await refreshTransactions()
    } catch (error) {
      console.error('Failed to bulk change type:', error)
    }
  }

  // Handle filter changes
  const handleFilterChange = (filters: any) => {
    setSelectedCategories(filters.selectedCategories || [])
    setSelectedTags(filters.selectedTags || [])
    setCurrentPage(1)
    if (filters.dateRange) {
      setDateRange(filters.dateRange)
    }
    if (filters.selectedPreset) {
      setSelectedPreset(filters.selectedPreset)
      if (filters.selectedPreset !== 'custom' && filters.selectedPreset !== 'all') {
        applyDatePreset(filters.selectedPreset)
      } else if (filters.selectedPreset === 'all') {
        setDateRange({ from: '', to: '' })
      }
    }
  }

  // Handle pagination changes
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // Calculate filtered results
  const filteredTransactions = createMemo(() => {
    const allTransactions = transactions()
    const filtered = allTransactions.filter((tx) => {
      // Filter by type
      if (filterType() !== 'all' && tx.type !== filterType()) {
        return false
      }

      // Filter by month
      if (filterMonth() && !tx.date.startsWith(filterMonth()!)) {
        return false
      }

      // Filter by search term
      const search = searchTerm().toLowerCase()
      if (
        search &&
        !tx.description.toLowerCase().includes(search) &&
        !tx.beneficiary?.toLowerCase().includes(search)
      ) {
        return false
      }

      // Filter by category
      if (selectedCategories().length > 0 && !selectedCategories().includes(tx.category_id || 0)) {
        return false
      }

      // Filter by tag
      if (
        selectedTags().length > 0 &&
        (!tx.tags || !selectedTags().some((id) => tx.tags?.some((t) => t.id === id)))
      ) {
        return false
      }

      // Filter by date range
      if (dateRange().from && tx.date < dateRange().from) {
        return false
      }
      if (dateRange().to && tx.date > dateRange().to) {
        return false
      }

      // Filter by reconciled status
      if (!showReconciled() && tx.reconciled) {
        return false
      }

      return true
    })

    // Apply sorting
    const field = sortField()
    const order = sortOrder()
    filtered.sort((a, b) => {
      let valA: string | number | undefined
      let valB: string | number | undefined

      switch (field) {
        case 'date':
          valA = a.date
          valB = b.date
          break
        case 'description':
          valA = a.description
          valB = b.description
          break
        case 'amount':
          valA = a.amount
          valB = b.amount
          break
        case 'category':
          valA = a.category_name ?? undefined
          valB = b.category_name ?? undefined
          break
        default:
          return 0
      }

      if (valA !== undefined && valB !== undefined) {
        if (typeof valA === 'string') {
          return order === 'asc'
            ? valA.localeCompare(valB as string)
            : (valB as string).localeCompare(valA)
        }
        if (typeof valA === 'number' && typeof valB === 'number') {
          return order === 'asc' ? (valA > valB ? 1 : -1) : valB > valA ? 1 : -1
        }
      }
      return 0
    })

    return filtered
  })

  // Get uncategorized transactions
  const uncategorizedTransactions = createMemo(() => {
    const allTransactions = transactions()
    return allTransactions.filter((tx) => tx.category_id === undefined || tx.category_id === null)
  })

  // Calculate paginated results
  const paginatedTransactions = createMemo(() => {
    const filtered = filteredTransactions()
    const start = (currentPage() - 1) * itemsPerPage()
    return filtered.slice(start, start + itemsPerPage())
  })

  // Page-level totals (defined after paginatedTransactions to avoid TDZ — createMemo runs eagerly).
  // Base-currency value, so mixed-currency pages total correctly.
  const pageIncome = createMemo(() =>
    paginatedTransactions()
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + Math.abs(txBaseValue(t)), 0)
  )
  const pageExpenses = createMemo(() =>
    paginatedTransactions()
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + Math.abs(txBaseValue(t)), 0)
  )
  const pageTotal = createMemo(() =>
    paginatedTransactions().reduce((s, t) => s + Math.abs(txBaseValue(t)), 0)
  )

  const totalPages = createMemo(() => Math.ceil(filteredTransactions().length / itemsPerPage()))

  const reconciledCount = createMemo(() => transactions().filter((t) => t.reconciled).length)

  // Auto-categorize handler
  const handleAutoApplyCategory = async (transactionId: number, categoryId: number) => {
    try {
      await api.updateTransaction(transactionId, { category_id: categoryId })
      // Reload transactions to update the view
      const data = (await api.getTransactions()) as Transaction[]
      setTransactions(data)
    } catch (error) {
      console.error('Failed to apply category:', error)
    }
  }

  // Refresh transactions handler
  const refreshTransactions = async () => {
    setLoading(true)
    try {
      const data = (await api.getTransactions()) as any
      // Backend returns { rows, total, limit, offset } for paginated responses
      const transactionsData: any[] = Array.isArray(data) ? data : (data?.rows ?? [])
      setTransactions(transactionsData as unknown as Transaction[])
    } catch (error) {
      console.error('Failed to reload transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  // Apply date preset — recalculates date range from preset
  const applyDatePreset = (preset: string) => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)

    const fmt = (d: Date) => d.toISOString().slice(0, 10)

    switch (preset) {
      case 'month':
        setDateRange({ from: fmt(startOfMonth), to: fmt(endOfMonth) })
        break
      case 'lastMonth':
        setDateRange({ from: fmt(startOfLastMonth), to: fmt(endOfLastMonth) })
        break
      case 'year':
        setDateRange({ from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` })
        break
    }
    setCurrentPage(1)
  }

  // Update form values when closing modal
  createEffect(() => {
    if (!isTransactionModalOpen()) {
      setFormId(null)
      setFormDescription('')
      setFormAmount('')
      setFormCategory(null)
      setFormBeneficiary('')
      setFormPayor('')
      setFormNotes('')
      setFormMeans('')
      setFormAmountLocal('')
    }
  })

  const openTransactionModal = () => {
    setType('expense')
    setFormId(null)
    setFormDescription('')
    setFormAmount('')
    setFormCurrency(getLocalCurrency())
    setFormExchangeRate('1')
    setFormCategory(null)
    setFormBeneficiary('')
    setFormPayor('')
    setFormNotes('')
    setFormMeans('')
    setFormAccountId(null)
    setFormAmountLocal('')
    setFormDate(new Date().toISOString().slice(0, 10))
    setSelectedFile(null)
    setExistingReceipt(null)
    revokePreviewUrl()
    setTransactionModalOpen(true)
  }

  const handleEditTransaction = (transaction: Transaction) => {
    setType(transaction.type)
    setFormId(transaction.id.toString())
    setFormDescription(transaction.description)
    setFormAmount(transaction.amount.toString())
    setFormCurrency(transaction.currency || getLocalCurrency())
    setFormExchangeRate('1')
    setFormCategory(transaction.category_id || null)
    setFormBeneficiary(transaction.beneficiary || '')
    setFormPayor(transaction.payor || '')
    setFormNotes(transaction.notes || '')
    setFormDate(transaction.date)
    setFormMeans(transaction.means_of_payment || '')
    setFormAccountId(transaction.account_id || null)
    setSelectedFile(null)
    setExistingReceipt(null)
    revokePreviewUrl()
    setTransactionModalOpen(true)
    // Show the already-attached receipt in the modal (async; modal opens immediately)
    if (typeof transaction.receipt_id === 'number') {
      void (async () => {
        try {
          const receipt = (await api.getReceipt(transaction.receipt_id!)) as Receipt
          const url = await loadReceiptBlobUrl(receipt.id)
          setExistingReceipt(receipt)
          setReceiptPreviewUrl(url)
        } catch (error) {
          console.error('Failed to load existing receipt:', error)
        }
      })()
    }
  }

  onMount(async () => {
    // (transactions load via the profileVersion effect above — no redundant fetch here)
    try {
      const cats = await api.getCategories()
      if (Array.isArray(cats)) {
        setCategories(cats as Category[])
        // Check hash for category filter (e.g. #transactions?category=Erste)
        const hash = window.location.hash.slice(1)
        const queryIdx = hash.indexOf('?')
        if (queryIdx >= 0) {
          const params = new URLSearchParams(hash.slice(queryIdx + 1))
          const categoryName = params.get('category')
          if (categoryName) {
            const matchedCat = (cats as Category[]).find(
              (c) => c.name.toLowerCase() === categoryName.toLowerCase()
            )
            if (matchedCat) {
              setSelectedCategories([matchedCat.id])
            }
          }
        }
      }
    } catch {
      // Categories will remain empty
    }
    try {
      const tagData = await api.getTags()
      if (Array.isArray(tagData)) setTags(tagData as any[])
    } catch {
      // Tags will remain empty
    }
    try {
      const acctData = await api.getAccounts()
      if (Array.isArray(acctData)) setAccounts(acctData as any[])
    } catch {
      // Accounts will remain empty
    }
  })

  return (
    <div class={`page page-transactions page-enter ${styles.transactionsPage}`}>
      <div class={styles.pageHeader}>
        <h1 data-test-id="transactions-header" data-tour="transactions-header">
          Transactions
        </h1>
        <div class={styles.tableActions}>
          <button
            class={`${styles.btnPrimary} ${styles.btnSm}`}
            onClick={openTransactionModal}
            data-test-id="add-transaction-btn"
            data-tour="transactions-add"
          >
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add
          </button>
          <button
            class={`${styles.btnSecondary} ${styles.btnSm}`}
            onClick={() => setAutoCategorizeModalOpen(true)}
          >
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Auto
          </button>
          <button
            class={`${styles.btnSecondary} ${styles.btnSm}`}
            onClick={() => setReconciliationModalOpen(true)}
            disabled={selectedTransactions().length === 0}
          >
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" />
            </svg>
            Reconcile
          </button>
        </div>
      </div>

      {/* Filter Bar — everything in one row */}
      <FilterBar
        categories={categories() as any}
        tags={tags() as any}
        selectedCategories={selectedCategories()}
        selectedTags={selectedTags()}
        dateRange={dateRange()}
        selectedPreset={selectedPreset()}
        showReconciled={showReconciled()}
        reconciledCount={reconciledCount()}
        onToggleReconciled={() => setShowReconciled(!showReconciled())}
        onCategoryChange={(ids) => {
          setSelectedCategories(ids)
          setCurrentPage(1)
        }}
        searchTerm={searchTerm()}
        onSearchChange={(t) => setSearchTerm(t)}
        filterType={filterType()}
        onFilterTypeChange={(t) => {
          setFilterType(t)
          setCurrentPage(1)
        }}
        onChange={handleFilterChange}
      />

      {/* Period Summary Bar */}
      <TransactionSummaryBar
        totalAmount={totalAmount()}
        totalIncome={totalIncome()}
        totalExpenses={totalExpenses()}
        netBalance={netBalance()}
        transactionCount={filteredTransactions().length}
        label={periodLabel()}
      />

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={selectedTransactions().length}
        categories={categories()}
        onClearSelection={() => setSelectedTransactions([])}
        onDeleteSelected={handleBulkDelete}
        onReconcileSelected={handleBulkReconcile}
        onChangeCategory={handleBulkChangeCategory}
        onChangeType={handleBulkChangeType}
      />

      {/* Recurring Transactions */}
      <RecurringSection categories={categories()} onRefreshTransactions={refreshTransactions} />

      {/* Transaction Modal */}
      <div
        class={`${styles.modalOverlay} ${isTransactionModalOpen() ? styles.show : ''}`}
        data-test-id="tx-modal"
        role="dialog"
        aria-modal="true"
        onclick={() => {
          _closeModals()
        }}
      >
        <div
          class={styles.modal}
          onclick={(e) => {
            e.stopPropagation()
          }}
        >
          <div class={styles.modalHeader}>
            <div class={styles.modalTitle} id="tx-modal-title">
              {formId() ? 'Edit Transaction' : 'Add Transaction'}
            </div>
            <button class={styles.btnGhost} onclick={_closeModals as any} aria-label="Close modal">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class={styles.modalBody}>
            <form id="tx-form">
              <input type="hidden" value={formId() ?? ''} />
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Type</label>
                <div class={styles.typeSelector} data-test-id="tx-type-selector">
                  <button
                    type="button"
                    data-test-id="tx-type-expense"
                    class={`${styles.expense} ${type() === 'expense' ? styles.active : ''}`}
                    onClick={() => {
                      setType('expense')
                      setFormCategory(null)
                    }}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    data-test-id="tx-type-income"
                    class={`${styles.income} ${type() === 'income' ? styles.active : ''}`}
                    onClick={() => {
                      setType('income')
                      setFormCategory(null)
                    }}
                  >
                    Income
                  </button>
                  <button
                    type="button"
                    data-test-id="tx-type-transfer"
                    class={`${styles.transfer} ${type() === 'transfer' ? styles.active : ''}`}
                    onClick={() => {
                      setType('transfer')
                      setFormCategory(null)
                    }}
                  >
                    Transfer
                  </button>
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Description</label>
                <input
                  type="text"
                  class={styles.formControl}
                  data-test-id="tx-description"
                  value={formDescription()}
                  onInput={(e) => setFormDescription((e.target as HTMLInputElement).value)}
                  required
                />
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    class={styles.formControl}
                    data-test-id="tx-amount"
                    value={formAmount()}
                    onInput={(e) => setFormAmount((e.target as HTMLInputElement).value)}
                    required
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Currency</label>
                  <select
                    class={styles.formControl}
                    data-test-id="tx-currency"
                    value={formCurrency()}
                    onInput={(e) => setFormCurrency((e.target as HTMLSelectElement).value)}
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="JPY">JPY</option>
                    <option value="CAD">CAD</option>
                    <option value="AUD">AUD</option>
                    <option value="CHF">CHF</option>
                    <option value="CNY">CNY</option>
                    <option value="INR">INR</option>
                  </select>
                </div>
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Date</label>
                  <input
                    type="date"
                    class={styles.formControl}
                    data-test-id="tx-date"
                    value={formDate()}
                    required
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Category</label>
                  <select
                    class={styles.formControl}
                    data-test-id="tx-category"
                    value={formCategory() ?? ''}
                    onchange={(e) => {
                      const value = (e.target as HTMLSelectElement).value
                      setFormCategory(value !== '' ? parseInt(value) : null)
                    }}
                  >
                    <option value="">Uncategorized</option>
                    <For each={filteredCategories()}>
                      {(cat) => <option value={cat.id}>{cat.name}</option>}
                    </For>
                  </select>
                </div>
              </div>
              <div class={`${styles.formGroup} ${styles.txTagSelector}`}>
                <label class={styles.formLabel}>Tags</label>
                <div class={styles.txTagChips}></div>
                <div class={styles.txTagInputRow}>
                  <input
                    type="text"
                    class={styles.txTagNewInput}
                    data-test-id="tx-tag-new-input"
                    placeholder="Type tag name, press Enter to create..."
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const input = e.target as HTMLInputElement
                        const tagName = input.value.trim()
                        if (tagName) {
                          try {
                            const newTag = await api.createTag(tagName, '#6366f1')
                            setSelectedTags([...selectedTags(), newTag.id])
                            input.value = ''
                          } catch {
                            // Tag creation failed
                          }
                        }
                      }
                    }}
                  />
                </div>
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Beneficiary</label>
                  <input
                    type="text"
                    class={styles.formControl}
                    data-test-id="tx-beneficiary"
                    placeholder="Who you paid"
                    value={formBeneficiary()}
                    onInput={(e) => setFormBeneficiary((e.target as HTMLInputElement).value)}
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Payor</label>
                  <input
                    type="text"
                    class={styles.formControl}
                    data-test-id="tx-payor"
                    placeholder="Who paid you"
                    value={formPayor()}
                    onInput={(e) => setFormPayor((e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Amount in Local Currency</label>
                  <input
                    type="number"
                    step="0.01"
                    class={styles.formControl}
                    data-test-id="tx-amount-local"
                    value={formAmountLocal()}
                    onInput={(e) => setFormAmountLocal((e.target as HTMLInputElement).value)}
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Exchange Rate</label>
                  <input
                    type="number"
                    step="0.0001"
                    class={styles.formControl}
                    data-test-id="tx-exchange-rate"
                    value={formExchangeRate()}
                    onInput={(e) => setFormExchangeRate((e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Means of Payment</label>
                <select
                  class={styles.formControl}
                  data-test-id="tx-means"
                  value={formMeans()}
                  onInput={(e) => setFormMeans((e.target as HTMLSelectElement).value)}
                >
                  <option value="">Select...</option>
                  <option value="Cash">Cash</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Debit Card">Debit Card</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Mobile Payment">Mobile Payment</option>
                  <option value="Check">Check</option>
                  <option value="Wire Transfer">Wire Transfer</option>
                </select>
              </div>
              {accounts().length > 0 && (
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Account</label>
                  <select
                    class={styles.formControl}
                    value={formAccountId() ?? ''}
                    onInput={(e) => {
                      const val = (e.target as HTMLSelectElement).value
                      setFormAccountId(val ? parseInt(val) : null)
                    }}
                  >
                    <option value="">No account</option>
                    <For each={accounts()}>
                      {(acct) => (
                        <option value={String(acct.id)}>
                          {acct.name} ({acct.type})
                        </option>
                      )}
                    </For>
                  </select>
                </div>
              )}
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Receipt</label>
                <div class={styles.receiptUploadContainer}>
                  <label class={styles.receiptPlaceholder} for="tx-receipt">
                    <svg
                      width="20"
                      height="20"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span class={styles.receiptText}>Click to upload receipt</span>
                  </label>
                  <input
                    id="tx-receipt"
                    type="file"
                    class={styles.receiptInput}
                    accept="image/*,.pdf"
                    onChange={_handleReceiptFileSelect}
                  />
                  {receiptPreviewUrl() && (
                    <>
                      {(selectedFile()?.type || existingReceipt()?.file_type || '').startsWith(
                        'image/'
                      ) ? (
                        <img
                          src={receiptPreviewUrl()!}
                          alt="Receipt preview"
                          class={styles.receiptThumbnail}
                        />
                      ) : (
                        <div
                          style={{
                            padding: '16px',
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border)',
                            'border-style': 'solid',
                            'border-radius': '8px',
                            'text-align': 'center',
                          }}
                        >
                          <svg
                            width="32"
                            height="32"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            style="opacity: 0.5; margin-bottom: 8px"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                            />
                          </svg>
                          <div style="font-size: 14px">
                            {selectedFile()?.name || existingReceipt()?.original_name || 'Unknown'}
                          </div>
                          <div style="font-size: 12px; color: var(--text-secondary)">
                            {(
                              (selectedFile()?.size ?? existingReceipt()?.file_size ?? 0) / 1024
                            ).toFixed(1)}{' '}
                            KB
                          </div>
                        </div>
                      )}
                      <div class={styles.receiptActions}>
                        <button
                          type="button"
                          class={`${styles.btnGhost} ${styles.btnSm}`}
                          onClick={async () => {
                            const existing = existingReceipt()
                            if (existing) {
                              // Removing a stored receipt deletes it server-side
                              if (
                                !(await showConfirm(
                                  `Delete receipt "${existing.original_name}"?`
                                ))
                              )
                                return
                              try {
                                await api.deleteReceipt(existing.id)
                                setExistingReceipt(null)
                                await refreshTransactions()
                              } catch (error) {
                                console.error('Failed to delete receipt:', error)
                                toast('Failed to delete receipt', 'error')
                                return
                              }
                            }
                            setSelectedFile(null)
                            revokePreviewUrl()
                          }}
                          title="Remove receipt"
                        >
                          <svg
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Remove
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Notes</label>
                <textarea
                  class={styles.formControl}
                  data-test-id="tx-notes"
                  rows="2"
                  value={formNotes()}
                  onInput={(e) => setFormNotes((e.target as HTMLTextAreaElement).value)}
                ></textarea>
              </div>
            </form>
          </div>
          <div class={styles.modalFooter}>
            <button class={styles.btnSecondary} data-test-id="tx-cancel-btn" onclick={_closeModals}>
              Cancel
            </button>
            <button
              class={styles.btnPrimary}
              data-test-id="tx-save-btn"
              onclick={async () => {
                // Validation
                const desc = formDescription().trim()
                const amtStr = formAmount().trim()
                const amt = parseFloat(amtStr)
                if (!desc) {
                  toast('Please enter a description', 'warning')
                  return
                }
                if (!amtStr || isNaN(amt) || amt === 0) {
                  toast('Please enter a valid amount', 'warning')
                  return
                }
                if (!formDate()) {
                  toast('Please enter a date', 'warning')
                  return
                }
                if (type() !== 'transfer' && formCategory() === null) {
                  toast('Please select a category', 'warning')
                  return
                }

                const txData: Record<string, unknown> = {
                  description: desc,
                  amount: amt,
                  date: formDate() || new Date().toISOString().slice(0, 10),
                  type: type(),
                  category_id: formCategory() ?? null,
                  currency: formCurrency() || getLocalCurrency(),
                  means_of_payment: formMeans() || undefined,
                  account_id: formAccountId() ?? undefined,
                  notes: formNotes() || undefined,
                  beneficiary: formBeneficiary() || undefined,
                  payor: formPayor() || undefined,
                  exchange_rate: formExchangeRate() ? parseFloat(formExchangeRate()) : undefined,
                  amount_local: formAmountLocal() ? parseFloat(formAmountLocal()) : undefined,
                }

                try {
                  const txId = formId()
                  let savedId: number
                  if (txId) {
                    savedId = parseInt(txId)
                    await api.updateTransaction(
                      savedId,
                      txData as Parameters<typeof api.updateTransaction>[1]
                    )
                  } else {
                    const created = await api.createTransaction(
                      txData as Parameters<typeof api.createTransaction>[0]
                    )
                    savedId = (created as any).id ?? (created as any).transaction_id ?? 0
                  }

                  const file = selectedFile()
                  if (file && savedId) {
                    try {
                      await api.uploadReceipt(savedId, file)
                    } catch (receiptErr) {
                      console.error('Failed to upload receipt:', receiptErr)
                    }
                  }

                  await refreshTransactions()
                  setTransactionModalOpen(false)
                  setSelectedFile(null)
                  setExistingReceipt(null)
                  revokePreviewUrl()
                } catch (error) {
                  console.error('Failed to save transaction:', error)
                }
              }}
            >
              Save Transaction
            </button>
          </div>
        </div>
      </div>

      {/* Receipt View Modal */}
      {isReceiptModalOpen() && selectedReceipt() && (
        <div
          class={`${styles.modalOverlay} ${styles.show}`}
          id="receipt-modal"
          onclick={() => {
            closeReceiptModal()
          }}
        >
          <div
            class={`${styles.modal} ${styles.receiptModal}`}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <div class={styles.modalTitle}>Receipt</div>
              <button class={styles.btnGhost} onclick={closeReceiptModal} aria-label="Close modal">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class={styles.modalBody}>
              {(selectedReceipt()!.file_type || '').startsWith('image/') ? (
                <img
                  src={receiptPreviewUrl() || ''}
                  alt="Receipt"
                  style={{
                    'max-width': '100%',
                    'max-height': '70vh',
                    display: 'block',
                    margin: '0 auto',
                    'border-radius': '8px',
                  }}
                />
              ) : (
                <iframe
                  src={receiptPreviewUrl() || ''}
                  title="Receipt"
                  style={{
                    width: '100%',
                    height: '60vh',
                    border: '1px solid var(--border)',
                    'border-radius': '8px',
                  }}
                />
              )}
              <div class={styles.receiptMeta}>
                <div class={styles.receiptMetaItem}>
                  <span class={styles.receiptMetaLabel}>File Name</span>
                  <span>{selectedReceipt()!.original_name}</span>
                </div>
                <div class={styles.receiptMetaItem}>
                  <span class={styles.receiptMetaLabel}>File Type</span>
                  <span>{selectedReceipt()!.file_type}</span>
                </div>
                <div class={styles.receiptMetaItem}>
                  <span class={styles.receiptMetaLabel}>Size</span>
                  <span>{((selectedReceipt()!.file_size || 0) / 1024).toFixed(2)} KB</span>
                </div>
                <div class={styles.receiptMetaItem}>
                  <span class={styles.receiptMetaLabel}>Uploaded</span>
                  <span>{new Date(selectedReceipt()!.uploaded_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div class={styles.modalFooter}>
              <a
                href={receiptPreviewUrl() || '#'}
                download={selectedReceipt()!.original_name}
                class={styles.btnSecondary}
              >
                <svg
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  style="margin-right: 4px"
                >
                  <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Download
              </a>
              <button class={styles.btnDanger} onclick={deleteReceipt}>
                <svg
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  style="margin-right: 4px"
                >
                  <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
              <button class={styles.btnSecondary} onclick={closeReceiptModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {loading() ? (
        <div class={styles.loading}>Loading transactions...</div>
      ) : (
        <>
          {/* Page Summary (top) */}
          <TransactionSummaryBar
            totalAmount={pageTotal()}
            totalIncome={pageIncome()}
            totalExpenses={pageExpenses()}
            netBalance={pageIncome() - pageExpenses()}
            transactionCount={paginatedTransactions().length}
            label={`Page ${currentPage()} of ${totalPages()}`}
            variant="page"
          />

          {/* Top Pagination */}
          {totalPages() > 1 && (
            <Pagination
              currentPage={currentPage()}
              totalPages={totalPages()}
              itemsPerPage={itemsPerPage()}
              totalItems={filteredTransactions().length}
              onPageChange={handlePageChange}
            />
          )}
          <TransactionTable
            transactions={paginatedTransactions()}
            selectedTransactions={selectedTransactions()}
            onSelectionChange={handleSelectionChange}
            onSort={handleSortChange}
            sortField={sortField()}
            sortOrder={sortOrder()}
            onEdit={handleEditTransaction}
            onDelete={handleDeleteTransaction}
            onViewReceipt={(t) => void openReceiptForTransaction(t)}
          />
          {/* Page Summary (bottom) */}
          <TransactionSummaryBar
            totalAmount={pageTotal()}
            totalIncome={pageIncome()}
            totalExpenses={pageExpenses()}
            netBalance={pageIncome() - pageExpenses()}
            transactionCount={paginatedTransactions().length}
            label={`Page ${currentPage()} of ${totalPages()}`}
            variant="page"
          />
          {totalPages() > 1 && (
            <Pagination
              currentPage={currentPage()}
              totalPages={totalPages()}
              itemsPerPage={itemsPerPage()}
              totalItems={filteredTransactions().length}
              onPageChange={handlePageChange}
            />
          )}
        </>
      )}

      {/* Auto Categorize Modal */}
      <AutoCategorizeModal
        isOpen={isAutoCategorizeModalOpen}
        onClose={() => setAutoCategorizeModalOpen(false)}
        uncategorizedTransactions={uncategorizedTransactions}
        onApply={handleAutoApplyCategory}
      />

      {/* Reconciliation Modal */}
      <ReconciliationModal
        isOpen={isReconciliationModalOpen}
        onClose={() => setReconciliationModalOpen(false)}
        selectedTransactionIds={selectedTransactions()}
        onReconciled={refreshTransactions}
      />
    </div>
  )
}
