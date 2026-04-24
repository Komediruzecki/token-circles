/**
 * Transactions Component
 * Handles transaction listing, creation, and management with filtering, sorting, and pagination
 */
import { createEffect, createSignal, For } from 'solid-js'
import styles from '../components/TransactionsPage.module.css'
import { api } from '../core/api.js'
import TransactionTable from '../components/TransactionTable'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'
import type * as Models from '../types/models'

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
  const [selectedFile, setSelectedFile] = createSignal<File | null>(null)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = createSignal<string | null>(null)
  const [type, setType] = createSignal<TransactionType>('expense')
  const [categories, setCategories] = createSignal<
    Array<{ id: number; name: string; color: string }>
  >([])
  const [tags, setTags] = createSignal<Array<{ id: number; name: string; color: string }>>([])
  const [selectedCategories, setSelectedCategories] = createSignal<number[]>([])
  const [selectedTags, setSelectedTags] = createSignal<number[]>([])
  const [dateRange, setDateRange] = createSignal<{ from: string; to: string }>({ from: '', to: '' })
  const [selectedPreset, setSelectedPreset] = createSignal<string>('month')
  const [currentPage, setCurrentPage] = createSignal(1)
  const [itemsPerPage] = createSignal(10)
  const [sortField, setSortField] = createSignal<string>('date')
  const [sortOrder, setSortOrder] = createSignal<'asc' | 'desc'>('desc')
  const [filterType, setFilterType] = createSignal<string>('all')
  const [filterMonth, setFilterMonth] = createSignal<string | null>(null)
  const [searchTerm, setSearchTerm] = createSignal<string>('')
  const today = new Date().toISOString().slice(0, 7)

  // Load transactions function (exposed to window)
  // @ts-expect-error - Used via event delegation
  const _loadTransactions = async () => {
    try {
      setLoading(true)
      const data = (await api.getTransactions()) as any
      const transactionsData = Array.isArray(data) ? data : []
      setTransactions(transactionsData as Transaction[])

      // Extract unique categories and tags for filter bar
      const categoriesSet = new Map<number, { name: string; color: string }>()
      const tagsSet = new Map<number, { name: string; color: string }>()
      transactionsData.forEach((tx: any) => {
        if (tx.category_name) {
          if (!categoriesSet.has(tx.category_id || 0)) {
            const categoryNames = tx.category_name.split('|')
            categoriesSet.set(tx.category_id || 0, {
              name: categoryNames[categoryNames.length - 1].trim(),
              color: '#666666',
            })
          }
        }
        if (tx.tags && tx.tags.length > 0) {
          tx.tags.forEach((tag: any) => {
            if (!tagsSet.has(tag.id)) {
              tagsSet.set(tag.id, { name: tag.name, color: tag.color })
            }
          })
        }
      })

      setCategories(Array.from(categoriesSet.values()))
      setTags(Array.from(tagsSet.values()))
    } catch (error) {
      console.error('Failed to load transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  // Load receipt for transaction
  const _loadTransactionReceipt = async () => {
    const receipt = selectedReceipt()
    if (!receipt || !receipt.transaction_id) return

    try {
      const receipts = (await api.getReceiptsForTransaction(receipt.transaction_id)) as any
      if (receipts && receipts.length > 0) {
        // Download the receipt file
        const blob = (await api.getReceiptFile(receipts[0].id)) as any
        const url = URL.createObjectURL(blob)
        setReceiptPreviewUrl(url)
        setIsReceiptModalOpen(true)
      }
    } catch (error) {
      console.error('Failed to load receipt:', error)
    }
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
      setTransactions(transactionsData as Transaction[])
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

  // Calculate paginated results
  const paginatedTransactions = () => {
    const allTransactions = transactions()
    const filtered = allTransactions.filter((tx) => {
      // Filter by type
      if (filterType() !== 'all' && tx.type !== filterType()) {
        return false
      }

      // Filter by month
      if (filterMonth() && !tx.date.startsWith(filterMonth())) {
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

    const start = (currentPage() - 1) * itemsPerPage()
    return filtered.slice(start, start + itemsPerPage())
  }

  const totalPages = () => Math.ceil(paginatedTransactions().length / itemsPerPage())

  // Date presets
  const applyDatePreset = (preset: string) => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)

    const formatDate = (date: Date) => date.toISOString().slice(0, 7)

    switch (preset) {
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
    setSelectedPreset(preset)
    setCurrentPage(1)
  }

  // Initial load
  createEffect(() => {
    _loadTransactions()
  })

  return (
    <div class={`page page-transactions page-enter ${styles.transactionsPage}`}>
      <div class={styles.pageHeader}>
        <h1>Transactions</h1>
      </div>

      {/* Filter Bar */}
      <div class={styles.filterSection}>
        <FilterBar
          categories={categories()}
          tags={tags()}
          selectedCategories={selectedCategories()}
          selectedTags={selectedTags()}
          dateRange={dateRange()}
          selectedPreset={selectedPreset()}
          onChange={handleFilterChange}
        />
      </div>

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
                <div class="type-selector" id="tx-type-selector">
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
                    required
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Currency</label>
                  <select class={styles.formControl} id="tx-currency">
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
                  <input type="date" class={styles.formControl} id="tx-date" required />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Category</label>
                  <select class={styles.formControl} id="tx-category"></select>
                </div>
              </div>
              <div class="form-group tx-tag-selector">
                <label class={styles.formLabel}>Tags</label>
                <div class="tx-tag-chips" id="tx-tag-chips"></div>
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
                  />
                </div>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Payor</label>
                  <input
                    type="text"
                    class={styles.formControl}
                    id="tx-payor"
                    placeholder="Who paid you"
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
                    value="1"
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
                <div class="receipt-upload-container">
                  <label class="receipt-placeholder" for="tx-receipt" style="cursor: pointer">
                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span class="receipt-text">Click to upload receipt</span>
                  </label>
                  <input
                    type="file"
                    id="tx-receipt"
                    class="receipt-input"
                    accept="image/*,.pdf"
                    data-action="transactions:handleReceiptFileSelect"
                  />
                  {receiptPreviewUrl() && (
                    <>
                      {selectedFile()?.type.startsWith('image/') ? (
                        <img
                          src={receiptPreviewUrl()!}
                          alt="Receipt preview"
                          class="receipt-thumbnail"
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
                      <div class="receipt-actions">
                        <button
                          type="button"
                          class="btn btn-ghost btn-sm"
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
                <textarea class={styles.formControl} id="tx-notes" rows="2"></textarea>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick={_closeModals}>
              Cancel
            </button>
            <button class="btn btn-primary" id="tx-save-btn" data-action="transactions:save">
              Save Transaction
            </button>
          </div>
        </div>
      </div>

      {/* Receipt View Modal */}
      {isReceiptModalOpen() && selectedReceipt() && (
        <div
          class={`modal-overlay show receipt-modal`}
          id="receipt-modal"
          onclick={(e) => {
            if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
              closeReceiptModal()
            }
          }}
        >
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title">Receipt</div>
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
              <div class="receipt-meta">
                <div class="receipt-meta-item">
                  <span class="receipt-meta-label">File Name</span>
                  <span>{selectedReceipt()!.original_name}</span>
                </div>
                <div class="receipt-meta-item">
                  <span class="receipt-meta-label">File Type</span>
                  <span>{selectedReceipt()!.file_type}</span>
                </div>
                <div class="receipt-meta-item">
                  <span class="receipt-meta-label">Size</span>
                  <span>{(selectedReceipt()!.file_size / 1024).toFixed(2)} KB</span>
                </div>
                <div class="receipt-meta-item">
                  <span class="receipt-meta-label">Uploaded</span>
                  <span>{new Date(selectedReceipt()!.uploaded_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <a
                href={`/api/receipts/${selectedReceipt()!.id}/file`}
                download={selectedReceipt()!.original_name}
                class="btn btn-secondary"
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
              <button class="btn btn-danger" onclick={deleteReceipt}>
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
              <button class="btn btn-secondary" onclick={closeReceiptModal}>
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
    </div>
  )
}
