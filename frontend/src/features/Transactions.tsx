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
import { createEffect, createSignal, For, onMount } from 'solid-js'
import AutoCategorizeModal from '../components/AutoCategorizeModal'
import BulkActionBar from '../components/BulkActionBar'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'
import ReconciliationModal from '../components/ReconciliationModal'
import RecurringSection from '../components/RecurringSection'
import styles from '../components/TransactionsPage.module.css'
import TransactionSummaryBar from '../components/TransactionSummaryBar'
import TransactionTable from '../components/TransactionTable'
import { api, getLocalCurrency, toast } from '../core/api'
import { showConfirm } from '../core/confirmStore'
import { apiPut } from '../utils/api'
import type { Category, Receipt, Transaction, TransactionType } from '../types/models'

export default function Transactions() {
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
  const [accounts, setAccounts] = createSignal<Array<{ id: number; name: string; type: string }>>([])
  const [categories, setCategories] = createSignal<Category[]>([])
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

  // Calculate transaction totals
  createEffect(() => {
    const txs = transactions()
    const income = txs
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0)
    const expenses = txs
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0)
    const total = txs.reduce((sum, t) => sum + Math.abs(t.amount), 0)
    setTotalIncome(income)
    setTotalExpenses(expenses)
    setNetBalance(income - expenses)
    setTotalAmount(total)
  })

  // _loadTransactionReceipt - placeholder for receipt loading
  // @ts-expect-error unused but used by event delegation
  const _loadTransactionReceipt = async (_receipt: Receipt | null) => {
    // Placeholder - functionality can be extended
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

    // Create preview URL for images
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setReceiptPreviewUrl(url)
    }
  }

  // Close all modals
  const _closeModals = () => {
    setTransactionModalOpen(false)
  }

  // Close receipt modal
  const closeReceiptModal = () => {
    setIsReceiptModalOpen(false)
    setReceiptPreviewUrl(null)
    setSelectedReceipt(null)
  }

  // Delete receipt
  const deleteReceipt = async () => {
    const receipt = selectedReceipt()
    if (!receipt) return

    try {
      await api.deleteReceipt(receipt.id)
      // Reload transactions to remove the deleted receipt reference
      const data = (await api.getTransactions()) as Transaction[]
      setTransactions(data)
      closeReceiptModal()
    } catch (error) {
      console.error('Failed to delete receipt:', error)
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
      await apiPut('/api/transactions/bulk', { ids, action: 'update', data: { category_id: categoryId } })
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
    if (filters.selectedPreset) {
      applyDatePreset(filters.selectedPreset)
    } else if (filters.dateRange) {
      setDateRange(filters.dateRange)
    }
  }

  // Handle pagination changes
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // Calculate filtered results
  const filteredTransactions = () => {
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
          valA = a.category_name
          valB = b.category_name
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
  }

  // Get uncategorized transactions
  const uncategorizedTransactions = () => {
    const allTransactions = transactions()
    return allTransactions.filter((tx) => tx.category_id === undefined || tx.category_id === null)
  }

  // Calculate paginated results
  const paginatedTransactions = () => {
    const filtered = filteredTransactions()
    const start = (currentPage() - 1) * itemsPerPage()
    return filtered.slice(start, start + itemsPerPage())
  }

  const totalPages = () => Math.ceil(filteredTransactions().length / itemsPerPage())

  const reconciledCount = () => transactions().filter((t) => t.reconciled).length

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
      case 'custom':
        break
    }
    setSelectedPreset(preset)
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
    setFormId(null)
    setFormDescription('')
    setFormAmount('')
    setFormMeans('')
    setFormAccountId(null)
    setFormAmountLocal('')
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
    setTransactionModalOpen(true)
  }

  onMount(async () => {
    refreshTransactions()
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
        <h1 data-test-id="transactions-header">Transactions</h1>
        <div class={styles.tableActions}>
          <button
            class={`${styles.btnPrimary} ${styles.btnSm}`}
            onClick={openTransactionModal}
            data-test-id="add-transaction-btn"
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

      {/* Transaction Summary Bar */}
      <TransactionSummaryBar
        totalAmount={totalAmount()}
        totalIncome={totalIncome()}
        totalExpenses={totalExpenses()}
        netBalance={netBalance()}
        transactionCount={filteredTransactions().length}
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
                <div class={styles.typeSelector}>
                  <button
                    type="button"
                    class={`${styles.expense} ${type() === 'expense' ? styles.active : ''}`}
                    onClick={() => setType('expense')}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    class={`${styles.income} ${type() === 'income' ? styles.active : ''}`}
                    onClick={() => setType('income')}
                  >
                    Income
                  </button>
                  <button
                    type="button"
                    class={`${styles.transfer} ${type() === 'transfer' ? styles.active : ''}`}
                    onClick={() => setType('transfer')}
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
                    value={formAmount()}
                    onInput={(e) => setFormAmount((e.target as HTMLInputElement).value)}
                    required
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Currency</label>
                  <select
                    class={styles.formControl}
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
                  <input type="date" class={styles.formControl} value={formDate()} required />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Category</label>
                  <select
                    class={styles.formControl}
                    value={formCategory() ?? ''}
                    onchange={(e) => {
                      const value = (e.target as HTMLSelectElement).value
                      setFormCategory(value !== '' ? parseInt(value) : null)
                    }}
                  >
                    <option value=""></option>
                    <For each={categories()}>
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
                    value={formExchangeRate()}
                    onInput={(e) => setFormExchangeRate((e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Means of Payment</label>
                <select
                  class={styles.formControl}
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
                  <label class={styles.receiptPlaceholder} for="tx-receipt" style="cursor: pointer">
                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span class={styles.receiptText}>Click to upload receipt</span>
                  </label>
                  <input
                    type="file"
                    class={styles.receiptInput}
                    accept="image/*,.pdf"
                    onChange={_handleReceiptFileSelect}
                  />
                  {receiptPreviewUrl() && (
                    <>
                      {selectedFile()?.type.startsWith('image/') ? (
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
                          <div style="font-size: 14px">{selectedFile()!.name}</div>
                          <div style="font-size: 12px; color: var(--text-secondary)">
                            {(selectedFile()!.size / 1024).toFixed(1)} KB
                          </div>
                        </div>
                      )}
                      <div class={styles.receiptActions}>
                        <button
                          type="button"
                          class={`${styles.btnGhost} ${styles.btnSm}`}
                          onClick={() => {
                            setSelectedFile(null)
                            setReceiptPreviewUrl(null)
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
                  rows="2"
                  value={formNotes()}
                  onInput={(e) => setFormNotes((e.target as HTMLTextAreaElement).value)}
                ></textarea>
              </div>
            </form>
          </div>
          <div class={styles.modalFooter}>
            <button class={styles.btnSecondary} onclick={_closeModals}>
              Cancel
            </button>
            <button
              class={styles.btnPrimary}
              onclick={async () => {
                const txData: Record<string, unknown> = {
                  description: formDescription(),
                  amount: parseFloat(formAmount() || '0'),
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
                  setReceiptPreviewUrl(null)
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
          class={`${styles.modalOverlay} ${styles.show} ${styles.receiptModal}`}
          id="receipt-modal"
          onclick={() => {
            closeReceiptModal()
          }}
        >
          <div
            class={`${styles.modal} ${styles.modalLg}`}
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
              <img
                src={receiptPreviewUrl() || `/api/receipts/${selectedReceipt()!.id}/file`}
                alt="Receipt"
                style={{
                  'max-width': '100%',
                  'max-height': '70vh',
                  display: 'block',
                  margin: '0 auto',
                  'border-radius': '8px',
                }}
              />
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
                href={`/api/receipts/${selectedReceipt()!.id}/file`}
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
          <TransactionTable
            transactions={paginatedTransactions()}
            selectedTransactions={selectedTransactions()}
            onSelectionChange={handleSelectionChange}
            onSort={handleSortChange}
            sortField={sortField()}
            sortOrder={sortOrder()}
            onEdit={handleEditTransaction}
            onDelete={handleDeleteTransaction}
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
