/**
 * Transactions Component
 * Handles transaction listing, creation, and management
 */

import { createEffect, createSignal } from 'solid-js'
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
  const [_selectedTransactions, _setSelectedTransactions] = createSignal<number[]>([])
  const [_filterType, _setFilterType] = createSignal<string>('all')
  const [_filterMonth, _setFilterMonth] = createSignal<string>('')
  const [_searchTerm, _setSearchTerm] = createSignal('')
  const [selectedReceipt, setSelectedReceipt] = createSignal<Receipt | null>(null)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = createSignal(false)
  const [isTransactionModalOpen, _setTransactionModalOpen] = createSignal(false)
  const [selectedFile, setSelectedFile] = createSignal<File | null>(null)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = createSignal<string | null>(null)
  const [type, _setType] = createSignal<TransactionType>('expense')
  const _today = new Date().toISOString().slice(0, 7)

  // Helper to get type selector state (used by event delegation)
  // @ts-expect-error - Helper (not used, kept for future)
  const _getTypeSelectorState = () => 'all'

  const _isTypeSelected = (_typeStr: string) => {
    const selector = document.getElementById('tx-type-selector')
    return selector?.classList.contains(`selected-${_typeStr}`) || false
  }

  // Currency exchange rate cache (unused, keeping for future)
  // @ts-expect-error unused cache for future feature
  const _exchangeRates = new Map<string, { rate: number; timestamp: number }>()

  /**
   * Fetch exchange rate for a currency pair
   * Uses USD as base for simplicity
   */
  const _fetchExchangeRate = async (targetCurrency: string): Promise<number> => {
    const cacheKey = `USD-${targetCurrency}`
    const cached = _exchangeRates.get(cacheKey)

    // Check cache validity (5 minutes)
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.rate
    }

    try {
      const data = await api.getExchangeRates('USD', targetCurrency) as any
      const rate = data.rates[targetCurrency] || 1
      _exchangeRates.set(cacheKey, { rate: rate || 1, timestamp: Date.now() })
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
  // @ts-expect-error - Helper (not used, kept for future)
  const _getForeignAmount = async (_amount: number, _foreignCurrency: string): Promise<number> => {
    return _amount
  }

  const _convertToLocal = async (
    amount: number,
    foreignCurrency: string
  ): Promise<number> => {
    const rate = await _fetchExchangeRate(foreignCurrency)
    return amount * rate
  }

  /**
  // @ts-expect-error - Helper (not used, kept for future)

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
    if (exchangeRateInput) {
      exchangeRateInput.value = rate.toString()
    }

    // Convert local amount back to foreign currency
    const foreignAmount = localAmount / rate
    if (amountInput) {
      amountInput.value = foreignAmount.toFixed(2)
    }
  }

  /**
   * Update exchange rate manually
   */
  const _handleExchangeRateChange = (_event: Event) => {
    const target = _event.target as HTMLInputElement
    const rate = parseFloat(target.value) || 1

    const amountInput = document.getElementById('tx-amount') as HTMLInputElement
    const localAmountInput = document.getElementById('tx-amount-local') as HTMLInputElement

    if (!amountInput || !localAmountInput) return

    const amount = parseFloat(amountInput.value) || 0
    const localAmount = amount * rate
    if (localAmountInput) {
      localAmountInput.value = localAmount.toFixed(2)
    }
  }

  // Refresh transactions when selected transaction changes
  createEffect(() => {
    if (selectedReceipt() && isReceiptModalOpen()) {
      _loadTransactionReceipt()
    }
  })

  // Load transactions function (exposed to window)
  // @ts-expect-error - Used via event delegation
  const _loadTransactions = async () => {
    try {
      setLoading(true)
      const data = await api.getTransactions() as any
      setTransactions(data as Transaction[])
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
      const receipts = await api.getReceiptsForTransaction(receipt.transaction_id) as any
      if (receipts && receipts.length > 0) {
        // Download the receipt file
        const blob = await api.getReceiptFile(receipts[0].id) as any
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
  const _handleReceiptFileSelect = (_event: Event) => {
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

  /**
   * Close all modals
   */
  const _closeModals = () => {
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
      await api.deleteReceipt(receipt.id) as any
      // Reload transactions to remove the deleted receipt reference
      const data = await api.getTransactions() as any
      setTransactions(data as Transaction[])
      closeReceiptModal()
    } catch (error) {
      console.error('Failed to delete receipt:', error)
    }
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
            <button class="btn btn-ghost" onclick={_closeModals as any} aria-label="Close modal">
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
    </div>
  )
}