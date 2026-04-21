/**
 * Transactions Component
 * Handles transaction listing, creation, and management
 */

import { onMount, createEffect } from 'solid-js'
import { createSignal } from 'solid-js'
import { api } from '../core/api.js'

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
  beneficiary?: string
  payor?: string
  reconciled: boolean
  receipt_id: number | null
  receipt_name: string
}

export default function Transactions() {
  const [_transactions, setTransactions] = createSignal<Transaction[]>([])
  const [_loading, setLoading] = createSignal(true)
  const [_setSelectedTransactions] = createSignal<number[]>([])
  const [_setFilterType] = createSignal<string>('')
  const [_setFilterMonth] = createSignal<string>('')
  const [_setSearchTerm] = createSignal('')
  const [selectedReceipt, setSelectedReceipt] = createSignal<Receipt | null>(null)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = createSignal(false)
  const [isTransactionModalOpen, setTransactionModalOpen] = createSignal(false)
  const [_setSelectedTxId] = createSignal<number | null>(null)
  const [_selectedFile, setSelectedFile] = createSignal<File | null>(null)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = createSignal<string | null>(null)
  const [type, setType] = createSignal<TransactionType>('expense')
  const today = new Date().toISOString().slice(0, 7)

  // Expose functions to window for event handlers
  window.transactionsSetType = setType
  window.transactionsLoad = loadTransactions
  window.transactionsSetFilterType = _setFilterType
  window.transactionsSetFilterMonth = _setFilterMonth
  window.transactionsSetSearchTerm = _setSearchTerm
  window.transactionsSetSelectedTxId = _setSelectedTxId
  window.transactionsSetLoading = setLoading

  // Load transactions on mount
  onMount(async () => {
    await loadTransactions()
  })

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

  // Currency exchange rate cache
  const exchangeRates = new Map<string, { rate: number; timestamp: number }>()

  /**
   * Fetch exchange rate for a currency pair
   * Uses USD as base for simplicity
   */
  const _fetchExchangeRate = async (targetCurrency: string): Promise<number> => {
    const cacheKey = `USD-${targetCurrency}`
    const cached = exchangeRates.get(cacheKey)

    // Check cache validity (5 minutes)
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.rate
    }

    try {
      const data = await api.getExchangeRates('USD', targetCurrency)
      const rate = data.rates[targetCurrency] || 1
      exchangeRates.set(cacheKey, { rate: rate || 1, timestamp: Date.now() })
      return rate || 1
    } catch (error) {
      console.warn('Failed to fetch exchange rate:', error)
      return 1
    }
  }

  /**
   * Convert amount from foreign currency to local currency
   * @param amount - Amount in foreign currency
   * @param foreignCurrency - Currency code of the amount
   * @returns Converted amount
   */
  const convertToLocal = async (
    amount: number,
    foreignCurrency: string
  ): Promise<number> => {
    const rate = await _fetchExchangeRate(foreignCurrency)
    return amount * rate
  }

  /**
   * Update transaction modal with currency conversion
   * Called when currency selector changes
   */
  const _handleCurrencyChange = async (event: Event) => {
    const target = event.target as HTMLSelectElement
    const foreignCurrency = target.value
    const amountInput = document.getElementById('tx-amount') as HTMLInputElement
    const exchangeRateInput = document.getElementById('tx-exchange-rate') as HTMLInputElement
    const localAmountInput = document.getElementById('tx-amount-local') as HTMLInputElement

    if (!amountInput || !exchangeRateInput || !localAmountInput) return

    const amount = parseFloat(amountInput.value) || 0
    if (amount === 0) return

    // Fetch exchange rate
    const rate = await _fetchExchangeRate(foreignCurrency)

    // Update exchange rate input
    exchangeRateInput.value = rate.toString()

    // Calculate and update local amount
    const localAmount = convertToLocal(amount, foreignCurrency)
    localAmountInput.value = localAmount.toFixed(2)

    // Also update the amount field to local currency for editing
    amountInput.value = localAmount.toFixed(2)
  }

  /**
   * Update foreign amount when local currency amount changes
   * Called when tx-amount-local input changes
   */
  const _handleLocalAmountChange = async (event: Event) => {
    const target = event.target as HTMLInputElement
    const localAmount = parseFloat(target.value) || 0

    const foreignCurrencyInput = document.getElementById('tx-currency') as HTMLSelectElement
    const amountInput = document.getElementById('tx-amount') as HTMLInputElement
    const exchangeRateInput = document.getElementById('tx-exchange-rate') as HTMLInputElement

    if (!foreignCurrencyInput || !amountInput || !exchangeRateInput) return

    const foreignCurrency = foreignCurrencyInput.value

    // Fetch exchange rate
    const rate = await _fetchExchangeRate(foreignCurrency)
    exchangeRateInput.value = rate.toString()

    // Convert local amount back to foreign currency
    const foreignAmount = localAmount / rate
    amountInput.value = foreignAmount.toFixed(2)
  }

  /**
   * Update exchange rate manually
   */
  const _handleExchangeRateChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    const rate = parseFloat(target.value) || 1

    const amountInput = document.getElementById('tx-amount') as HTMLInputElement
    const localAmountInput = document.getElementById('tx-amount-local') as HTMLInputElement

    if (!amountInput || !localAmountInput) return

    const amount = parseFloat(amountInput.value) || 0
    const localAmount = amount * rate
    localAmountInput.value = localAmount.toFixed(2)
  }

  /**
   * Open transaction modal
   */
  const _openModal = () => {
    // Find modal elements
    const _amountInput = document.getElementById('tx-amount') as HTMLInputElement
    const _currencyInput = document.getElementById('tx-currency') as HTMLSelectElement
    const _localAmountInput = document.getElementById('tx-amount-local') as HTMLInputElement
    const _exchangeRateInput = document.getElementById('tx-exchange-rate') as HTMLInputElement
    const _receiptInput = document.getElementById('tx-receipt') as HTMLInputElement

    if (!_amountInput || !_currencyInput || !_localAmountInput || !_exchangeRateInput) return

    // Set default date to today
    const _dateInput = document.getElementById('tx-date') as HTMLInputElement
    if (_dateInput) _dateInput.value = today

    // Reset receipt
    if (_receiptInput) _receiptInput.value = ''

    // Clear preview
    setReceiptPreviewUrl(null)
    setSelectedFile(null)

    // Get local currency from settings
    const localCurrency = localStorage.getItem('localCurrency') || 'USD'

    // Initialize with local currency
    _currencyInput.value = localCurrency
    _exchangeRateInput.value = '1'
    _localAmountInput.value = ''
    _amountInput.value = ''

    setTransactionModalOpen(true)
  }

  // Refresh transactions when selected transaction changes
  createEffect(() => {
    if (selectedReceipt() && isReceiptModalOpen()) {
      loadTransactionReceipt()
    }
  })

  // Load receipt for transaction
  const loadTransactionReceipt = async () => {
    const receipt = selectedReceipt()
    if (!receipt || !receipt.transaction_id) return

    try {
      const receipts = await api.getReceiptsForTransaction(receipt.transaction_id)
      if (receipts.length > 0) {
        // Download the receipt file
        const blob = await api.getReceiptFile(receipts[0].id)
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
  const _handleReceiptFileSelect = (event: Event) => {
    const target = event.target as HTMLInputElement
    const _file = target.files?.[0]

    if (!_file) return

    // Check file size (max 5MB)
    if (_file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB')
      target.value = ''
      return
    }

    setSelectedFile(_file)

    // Create preview URL for images
    if (_file.type.startsWith('image/')) {
      const url = URL.createObjectURL(_file)
      setReceiptPreviewUrl(url)
    }
  }

  /**
   * Remove selected receipt
   */
  const _removeReceipt = () => {
    const _receiptInput = document.getElementById('tx-receipt') as HTMLInputElement
    if (_receiptInput) {
      _receiptInput.value = ''
    }
    setReceiptPreviewUrl(null)
    setSelectedFile(null)
  }

  /**
   * Handle file upload when saving transaction
   */
  const _handleTransactionSave = async () => {
    const _idInput = document.getElementById('tx-id') as HTMLInputElement
    const _descInput = document.getElementById('tx-description') as HTMLInputElement
    const _amountInput = document.getElementById('tx-amount') as HTMLInputElement
    const _currencyInput = document.getElementById('tx-currency') as HTMLSelectElement
    const _dateInput = document.getElementById('tx-date') as HTMLInputElement
    const _typeInput = document.getElementById('tx-type-selector') as HTMLElement
    const _categoryInput = document.getElementById('tx-category') as HTMLSelectElement
    const _beneficiaryInput = document.getElementById('tx-beneficiary') as HTMLInputElement
    const _payorInput = document.getElementById('tx-payor') as HTMLInputElement
    const _meansInput = document.getElementById('tx-means') as HTMLSelectElement
    const _notesInput = document.getElementById('tx-notes') as HTMLTextAreaElement

    if (!_descInput || !_amountInput || !_dateInput || !_categoryInput || !_typeInput) return

    const desc = _descInput.value.trim()
    const amount = parseFloat(_amountInput.value)
    const date = _dateInput.value
    const currency = _currencyInput.value
    const category = parseInt(_categoryInput.value)
    const type = _typeInput.dataset.selectedType || 'expense'

    if (!desc || amount <= 0 || !date || !category) {
      alert('Please fill in all required fields')
      return
    }

    try {
      if (_idInput.value) {
        // Update existing transaction
        await api.updateTransaction(parseInt(_idInput.value), {
          description: desc,
          amount: amount,
          date: date,
          currency: currency,
          type: type,
          category_id: category,
          beneficiary: _beneficiaryInput.value || undefined,
          payor: _payorInput.value || undefined,
          means: _meansInput.value || undefined,
          notes: _notesInput.value || undefined,
        })
      } else {
        // Create new transaction
        await api.createTransaction({
          description: desc,
          amount: amount,
          date: date,
          currency: currency,
          type: type,
          category_id: category,
          beneficiary: _beneficiaryInput.value || undefined,
          payor: _payorInput.value || undefined,
          means: _meansInput.value || undefined,
          notes: _notesInput.value || undefined,
        })
      }

      // Handle receipt upload
      if (_selectedFile()) {
        const _txId = _idInput.value ? parseInt(_idInput.value) : null
        if (_txId) {
          await api.uploadReceipt(_txId, _selectedFile()!)
        }
      }

      _closeModals()
      await loadTransactions()
    } catch (error) {
      console.error('Failed to save transaction:', error)
      alert('Failed to save transaction. Please try again.')
    }
  }

  /**
   * Open receipt view modal
   */
  const _openReceiptModal = (receipt: Receipt) => {
    setSelectedReceipt(receipt)
    setIsReceiptModalOpen(true)
  }

  /**
   * Close receipt modal
   */
  const closeReceiptModal = () => {
    setIsReceiptModalOpen(false)
    setReceiptPreviewUrl(null)
    setSelectedReceipt(null)
  }

  /**
   * Delete receipt
   */
  const deleteReceipt = async () => {
    if (!selectedReceipt()) return

    try {
      await api.deleteReceipt(selectedReceipt()!.id)
      closeReceiptModal()
      await loadTransactions()
    } catch (error) {
      console.error('Failed to delete receipt:', error)
      alert('Failed to delete receipt')
    }
  }

  /**
   * Download receipt
   */
  const _downloadReceipt = () => {
    if (!selectedReceipt()) return

    // Create download link
    const link = document.createElement('a')
    link.href = receiptPreviewUrl() || `/api/receipts/${selectedReceipt()!.id}/file`
    link.download = selectedReceipt()!.original_name
    link.click()
  }

  /**
   * Close all modals
   */
  const _closeModals = () => {
    const modal = document.getElementById('tx-modal') as HTMLElement
    if (modal) modal.classList.remove('show')
    const modal2 = document.getElementById('quickadd-modal') as HTMLElement
    if (modal2) modal2.classList.remove('show')
  }

  // Helper to get type selector state
  const _isTypeSelected = (type: string) => {
    const selector = document.getElementById('tx-type-selector')
    return selector?.classList.contains(`selected-${type}`) || false
  }

  return (
    <div class="page page-transactions page-enter">
      <div class="page-header">
        <h1>Transactions</h1>
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
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title" id="tx-modal-title">
              Add Transaction
            </div>
            <button class="btn btn-ghost" onclick={_closeModals} aria-label="Close modal">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="modal-body">
            <form id="tx-form">
              <input type="hidden" id="tx-id" />
              <div class="form-group">
                <label class="form-label">Type</label>
                <div class="type-selector" id="tx-type-selector">
                  <button
                    type="button"
                    class={`expense ${type === 'expense' ? 'active' : ''}`}
                    data-action="transactions:setType"
                    data-arg="expense"
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    class={`income ${type === 'income' ? 'active' : ''}`}
                    data-action="transactions:setType"
                    data-arg="income"
                  >
                    Income
                  </button>
                  <button
                    type="button"
                    class={`transfer ${type === 'transfer' ? 'active' : ''}`}
                    data-action="transactions:setType"
                    data-arg="transfer"
                  >
                    Transfer
                  </button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Description</label>
                <input type="text" class="form-control" id="tx-description" required />
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Amount</label>
                  <input type="number" step="0.01" class="form-control" id="tx-amount" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Currency</label>
                  <select class="form-control" id="tx-currency">
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
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Date</label>
                  <input type="date" class="form-control" id="tx-date" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Category</label>
                  <select class="form-control" id="tx-category"></select>
                </div>
              </div>
              <div class="form-group tx-tag-selector">
                <label class="form-label">Tags</label>
                <div class="tx-tag-chips" id="tx-tag-chips"></div>
                <div class="tx-tag-input-row">
                  <input
                    type="text"
                    class="tx-tag-new-input"
                    id="tx-tag-new-input"
                    placeholder="Type tag name, press Enter to create..."
                    data-action="transactions:addTagFromInput"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Beneficiary</label>
                  <input
                    type="text"
                    class="form-control"
                    id="tx-beneficiary"
                    placeholder="Who you paid"
                  />
                </div>
                <div class="form-group">
                  <label class="form-label">Payor</label>
                  <input
                    type="text"
                    class="form-control"
                    id="tx-payor"
                    placeholder="Who paid you"
                  />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Amount in Local Currency</label>
                  <input type="number" step="0.01" class="form-control" id="tx-amount-local" />
                </div>
                <div class="form-group">
                  <label class="form-label">Exchange Rate</label>
                  <input
                    type="number"
                    step="0.0001"
                    class="form-control"
                    id="tx-exchange-rate"
                    value="1"
                  />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Means of Payment</label>
                <select class="form-control" id="tx-means">
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
              <div class="form-group">
                <label class="form-label">Receipt</label>
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
                      {_selectedFile()?.type.startsWith('image/') ? (
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
                            borderRadius: '8px',
                            textAlign: 'center',
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
                            <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <div style="font-size: 14px">{_selectedFile()!.name}</div>
                          <div style="font-size: 12px; color: var(--text-secondary)">
                            {(_selectedFile()!.size / 1024).toFixed(1)} KB
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
              <div class="form-group">
                <label class="form-label">Notes</label>
                <textarea class="form-control" id="tx-notes" rows="2"></textarea>
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
              <button class="btn btn-ghost" onclick={closeReceiptModal} aria-label="Close modal">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <img
                src={receiptPreviewUrl()}
                alt="Receipt"
                style={{
                  maxWidth: '100%',
                  maxHeight: '70vh',
                  display: 'block',
                  margin: '0 auto',
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
                href={receiptPreviewUrl() || `/api/receipts/${selectedReceipt()!.id}/file`}
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
    </div>
  )
}
