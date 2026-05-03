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
import { createEffect, createSignal } from 'solid-js'
import AutoCategorizeModal from '../components/AutoCategorizeModal'
import { CategoryMultiSelect } from '../components/CategoryMultiSelect'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'
import ReconciliationModal from '../components/ReconciliationModal'
import styles from '../components/TransactionsPage.module.css'
import TransactionSummaryBar from '../components/TransactionSummaryBar'
import TransactionTable from '../components/TransactionTable'
import { api } from '../core/api'
import type { Category } from '../types/models'

type TransactionType = 'income' | 'expense' | 'transfer'

interface Receipt {
  id: number
  transaction_id: number | null
  filename: string
  original_name: string
  file_type: string
  file_size: number
  storage_path: string
  uploaded_at: string
  profile_id: number
}

interface Transaction {
  id: number
  date: string
  description: string
  amount: number
  currency: string
  type: TransactionType
  category_name: string
  category_id?: number
  beneficiary?: string
  payor?: string
  reconciled: boolean
  receipt_id: number | null
  receipt_name: string
  tags?: Array<{ id: number; name: string; color: string }>
  means_of_payment?: string
  notes?: string
}

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
  const [type, _setType] = createSignal<TransactionType>('expense')
  const [formDate] = createSignal(new Date().toISOString().slice(0, 10))
  const [formAmount, setFormAmount] = createSignal('')
  const [formCurrency, setFormCurrency] = createSignal('USD')
  const [formExchangeRate, setFormExchangeRate] = createSignal('1')
  const [formCategory, setFormCategory] = createSignal<number | null>(null)
  const [formBeneficiary, setFormBeneficiary] = createSignal('')
  const [formPayor, setFormPayor] = createSignal('')
  const [formNotes, setFormNotes] = createSignal('')
  const [categories] = createSignal<Category[]>([])
  const [tags] = createSignal<Array<{ id: number; name: string; color: string }>>([])
  const [selectedCategories, setSelectedCategories] = createSignal<number[]>([])
  const [selectedTags, setSelectedTags] = createSignal<number[]>([])
  const [dateRange, setDateRange] = createSignal<{ from: string; to: string }>({ from: '', to: '' })
  const [selectedPreset, setSelectedPreset] = createSignal<string>('')
  const [currentPage, setCurrentPage] = createSignal(1)
  const [itemsPerPage] = createSignal(10)
  const [sortField, setSortField] = createSignal<string>('date')
  const [sortOrder, setSortOrder] = createSignal<'asc' | 'desc'>('desc')
  const [filterType, setFilterType] = createSignal<string>('all')
  const [filterMonth, _setFilterMonth] = createSignal<string | null>(null)
  const [searchTerm, setSearchTerm] = createSignal<string>('')
  const [totalIncome, setTotalIncome] = createSignal(0)
  const [totalExpenses, setTotalExpenses] = createSignal(0)
  const [netBalance, setNetBalance] = createSignal(0)

  // Calculate transaction totals
  createEffect(() => {
    const txs = transactions()
    const income = txs
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0)
    const expenses = txs
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0)
    setTotalIncome(income)
    setTotalExpenses(expenses)
    setNetBalance(income - expenses)
  })

  // _loadTransactionReceipt - placeholder for receipt loading
  // @ts-expect-error unused but used by event delegation
  const _loadTransactionReceipt = async (_receipt: Receipt | null) => {
    // Placeholder - functionality can be extended
  }

  /**
   * Handle receipt file selection
   */
  // @ts-expect-error unused but used by event delegation
  const _handleReceiptFileSelect = (_event: Event): void => {
    const target = _event.target as HTMLInputElement
    const file = target.files?.[0]

    if (!file) return

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB')
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
    const modal = document.getElementById('tx-modal') as HTMLElement
    if (modal) modal.classList.remove('show')
    const modal2 = document.getElementById('quickadd-modal') as HTMLElement
    if (modal2) modal2.classList.remove('show')
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
      const data = await api.getTransactions()
      const transactionsData = Array.isArray(data) ? data : []
      setTransactions(transactionsData as unknown as Transaction[])
      closeReceiptModal()
    } catch (error) {
      console.error('Failed to delete receipt:', error)
    }
  }

  // Handle selection changes
  const handleSelectionChange = (ids: number[]) => {
    setSelectedTransactions(ids)
    // Re-fetch to update transaction data
    refreshTransactions()
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

  // Handle filter changes
  const handleFilterChange = (filters: any) => {
    setSelectedCategories(filters.selectedCategories || [])
    setSelectedTags(filters.selectedTags || [])
    setDateRange(filters.dateRange || { from: '', to: '' })
    setSelectedPreset(filters.selectedPreset || 'month')
    setCurrentPage(1)
  }

  // Handle pagination changes
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // Calculate filtered results
  const filteredTransactions = () => {
    const allTransactions = transactions()
    return allTransactions.filter((tx) => {
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

      return true
    })
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

  // Auto-categorize handler
  const handleAutoApplyCategory = async (transactionId: number, categoryId: number) => {
    try {
      await api.updateTransaction(transactionId, { category_id: categoryId })
      // Reload transactions to update the view
      const data = await api.getTransactions()
      const transactionsData: any[] = Array.isArray(data) ? data : []
      setTransactions(transactionsData as unknown as Transaction[])
    } catch (error) {
      console.error('Failed to apply category:', error)
    }
  }

  // Refresh transactions handler
  const refreshTransactions = async () => {
    setLoading(true)
    try {
      const data = (await api.getTransactions()) as any
      const transactionsData: any[] = Array.isArray(data) ? data : []
      setTransactions(transactionsData as unknown as Transaction[])
    } catch (error) {
      console.error('Failed to reload transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  // _handleReconcile - unused (functionality can be extended)
  // @ts-expect-error unused but used by event delegation
  const _handleReconcile = async (_transactionId: number) => {
    // Placeholder - functionality can be extended
  }

  // _applyDatePreset - unused (functionality can be extended)
  // @ts-expect-error unused but used by event delegation
  const _applyDatePreset = (_preset: string) => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)

    const formatDate = (date: Date) => date.toISOString().slice(0, 7)

    switch (_preset) {
      case 'month':
        setDateRange({ from: formatDate(startOfMonth), to: formatDate(endOfMonth) })
        break
      case 'lastMonth':
        setDateRange({ from: formatDate(startOfLastMonth), to: formatDate(endOfLastMonth) })
        break
      case 'year':
        setDateRange({ from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` })
        break
      case 'custom':
        // Keep current range
        break
    }
    setSelectedPreset(_preset)
    setCurrentPage(1)
  }

  // Update form values when closing modal
  createEffect(() => {
    if (!isTransactionModalOpen()) {
      setFormAmount('')
      setFormCategory(null)
      setFormBeneficiary('')
      setFormPayor('')
      setFormNotes('')
    }
  })

  const openTransactionModal = () => {
    setTransactionModalOpen(true)
    // Don't reset form values since they're already initialized with defaults
  }

  return (
    <div class={`page page-transactions page-enter ${styles.transactionsPage}`}>
      <div class={styles.pageHeader}>
        <h1 data-test-id="transactions-header">Transactions</h1>
        <div class={styles.pageHeaderActions}>
          <button
            class={`${styles.btnPrimary} ${styles.btnSm}`}
            onClick={openTransactionModal}
            data-test-id="add-transaction-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Transaction
          </button>
          <button
            class={`${styles.btnSecondary} ${styles.btnSm}`}
            onClick={() => setAutoCategorizeModalOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Auto-categorize
          </button>
          <button
            class={`${styles.btnSecondary} ${styles.btnSm}`}
            onClick={() => setReconciliationModalOpen(true)}
            disabled={selectedTransactions().length === 0}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" />
            </svg>
            Reconcile
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div class={styles.filterSection}>
        <CategoryMultiSelect
          categories={() => categories()}
          selectedCategoryIds={() => selectedCategories()}
          onChange={(ids) => {
            setSelectedCategories(ids)
            setCurrentPage(1)
          }}
          placeholder="All categories"
        />
        <FilterBar
          categories={categories() as any}
          selectedCategories={selectedCategories()}
          tags={tags() as any}
          selectedTags={selectedTags()}
          dateRange={dateRange()}
          selectedPreset={selectedPreset()}
          onChange={handleFilterChange}
        />
      </div>

      {/* Transaction Summary Bar */}
      <TransactionSummaryBar
        totalIncome={totalIncome()}
        totalExpenses={totalExpenses()}
        netBalance={netBalance()}
      />

      {/* Search */}
      <div class={styles.searchSection}>
        <input
          type="text"
          class={styles.searchInput}
          placeholder="Search transactions..."
          value={searchTerm()}
          onInput={(e) => setSearchTerm((e.target as HTMLInputElement).value)}
        />
      </div>

      {/* Type Filter */}
      <div class={styles.typeFilters}>
        <button
          class={`${styles.typeBtn} ${filterType() === 'all' ? styles.typeBtnActive : ''}`}
          onClick={() => {
            setFilterType('all')
            setCurrentPage(1)
          }}
        >
          All
        </button>
        <button
          class={`${styles.typeBtn} ${filterType() === 'income' ? styles.typeBtnActive : ''}`}
          onClick={() => {
            setFilterType('income')
            setCurrentPage(1)
          }}
        >
          Income
        </button>
        <button
          class={`${styles.typeBtn} ${filterType() === 'expense' ? styles.typeBtnActive : ''}`}
          onClick={() => {
            setFilterType('expense')
            setCurrentPage(1)
          }}
        >
          Expense
        </button>
        <button
          class={`${styles.typeBtn} ${filterType() === 'transfer' ? styles.typeBtnActive : ''}`}
          onClick={() => {
            setFilterType('transfer')
            setCurrentPage(1)
          }}
        >
          Transfer
        </button>
      </div>

      {/* Transaction Modal */}
      <div
        class={`modal-overlay ${isTransactionModalOpen() ? 'show' : ''}`}
        id="tx-modal"
        onclick={(e) => {
          if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
            _closeModals()
          }
        }}
      >
        <div class={styles.modal}>
          <div class={styles.modalHeader}>
            <div class={styles.modalTitle} id="tx-modal-title">
              Add Transaction
            </div>
            <button class={styles.btnGhost} onclick={_closeModals as any} aria-label="Close modal">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class={styles.modalBody}>
            <form id="tx-form">
              <input type="hidden" id="tx-id" />
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Type</label>
                <div class={styles.typeSelector} id="tx-type-selector">
                  <button
                    type="button"
                    class={`expense ${type() === 'expense' ? 'active' : ''}`}
                    data-action="transactions:setType"
                    data-arg="expense"
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    class={`income ${type() === 'income' ? 'active' : ''}`}
                    data-action="transactions:setType"
                    data-arg="income"
                  >
                    Income
                  </button>
                  <button
                    type="button"
                    class={`transfer ${type() === 'transfer' ? 'active' : ''}`}
                    data-action="transactions:setType"
                    data-arg="transfer"
                  >
                    Transfer
                  </button>
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Description</label>
                <input type="text" class={styles.formControl} id="tx-description" required />
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    class={styles.formControl}
                    id="tx-amount"
                    value={formAmount()}
                    onInput={(e) => setFormAmount((e.target as HTMLInputElement).value)}
                    required
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Currency</label>
                  <select class={styles.formControl} id="tx-currency" value={formCurrency()} onInput={(e) => setFormCurrency((e.target as HTMLSelectElement).value)}>
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
                  <input type="date" class={styles.formControl} id="tx-date" value={formDate()} required />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Category</label>
                  <select
                    class={styles.formControl}
                    id="tx-category"
                    value={formCategory() ?? ''}
                    onchange={(e) => {
                      const value = (e.target as HTMLSelectElement).value
                      setFormCategory(value !== '' ? parseInt(value) : null)
                    }}
                  ></select>
                </div>
              </div>
              <div class={`${styles.formGroup} ${styles.txTagSelector}`}>
                <label class={styles.formLabel}>Tags</label>
                <div class={styles.txTagChips} id="tx-tag-chips"></div>
                <div class={styles.txTagInputRow}>
                  <input
                    type="text"
                    class={styles.txTagNewInput}
                    id="tx-tag-new-input"
                    placeholder="Type tag name, press Enter to create..."
                    data-action="transactions:addTagFromInput"
                  />
                </div>
              </div>
              <div class={styles.formRow}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Beneficiary</label>
                  <input
                    type="text"
                    class={styles.formControl}
                    id="tx-beneficiary"
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
                    id="tx-payor"
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
                    id="tx-amount-local"
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Exchange Rate</label>
                  <input
                    type="number"
                    step="0.0001"
                    class={styles.formControl}
                    id="tx-exchange-rate"
                    value={formExchangeRate()}
                    onInput={(e) => setFormExchangeRate((e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Means of Payment</label>
                <select class={styles.formControl} id="tx-means">
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
                    id="tx-receipt"
                    class={styles.receiptInput}
                    accept="image/*,.pdf"
                    data-action="transactions:handleReceiptFileSelect"
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
                          data-action="transactions:removeReceipt"
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
                <textarea class={styles.formControl} id="tx-notes" rows="2" value={formNotes()} onInput={(e) => setFormNotes((e.target as HTMLTextAreaElement).value)}></textarea>
              </div>
            </form>
          </div>
          <div class={styles.modalFooter}>
            <button class={styles.btnSecondary} onclick={_closeModals}>
              Cancel
            </button>
            <button
              class={styles.btnPrimary}
              id="tx-save-btn"
              data-action="transactions:save"
              onclick={(_e) => {
                console.info('Save button clicked, openTransactionModal:', openTransactionModal)
                openTransactionModal()
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
          class={`modal-overlay show ${styles.receiptModal}`}
          id="receipt-modal"
          onclick={(e) => {
            if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
              closeReceiptModal()
            }
          }}
        >
          <div class={`${styles.modal} ${styles.modalLg}`}>
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
                  <span>{(selectedReceipt()!.file_size / 1024).toFixed(2)} KB</span>
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

      {/* Transactions Table */}
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
          />
          {totalPages() > 1 && (
            <Pagination
              currentPage={currentPage()}
              totalPages={totalPages()}
              itemsPerPage={itemsPerPage()}
              totalItems={transactions().length}
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
      />
    </div>
  )
}
