/**
 * Event Handler Utilities
 * Migrated from legacy window.handlers, window.receipts, window.transactions
 */

export interface ReceiptData {
  id: number
  original_name: string
  file_type: string
  file_size: number
  uploaded_at: string
}

export interface TransactionData {
  id: number
  description: string
  amount: number
  date: string
  category_name: string
  type: 'income' | 'expense' | 'transfer'
  beneficiary?: string
  payor?: string
  notes?: string
}

export type ModalAction =
  | 'transactions:setType'
  | 'receipt-modal'
  | 'tx-modal:close'
  | 'modal:close'

/**
 * Handle file selection for receipts
 */
export function handleReceiptFileSelect(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]

  if (file === undefined) return

  // Check file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    alert('File size must be less than 5MB')
    target.value = ''
    return
  }

  // Create preview URL for images
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file)
    const preview = document.getElementById('receipt-thumbnail') as HTMLImageElement | null
    const placeholder = document.getElementById('receipt-placeholder')
    const actions = document.getElementById('receipt-actions')

    if (preview !== null) {
      preview.src = url
      preview.style.display = 'block'
    }
    if (placeholder !== null) {
      placeholder.style.display = 'none'
    }
    if (actions !== null) {
      actions.style.display = 'flex'
    }
  }
}

/**
 * Remove receipt preview
 */
export function removeReceiptPreview(): void {
  const receiptInput = document.getElementById('tx-receipt') as HTMLInputElement | null
  const preview = document.getElementById('receipt-thumbnail') as HTMLImageElement | null
  const placeholder = document.getElementById('receipt-placeholder')
  const actions = document.getElementById('receipt-actions')

  if (receiptInput !== null) {
    receiptInput.value = ''
  }
  if (preview !== null) {
    preview.src = ''
    preview.style.display = 'none'
  }
  if (placeholder !== null) {
    placeholder.style.display = 'flex'
  }
  if (actions !== null) {
    actions.style.display = 'none'
  }
}

/**
 * Delete receipt
 */
export async function deleteReceipt(receiptId: number): Promise<void> {
  try {
    const { api } = await import('./api.js')
    await api.deleteReceipt(receiptId)
    const modal = document.getElementById('receipt-modal')
    if (modal !== null) {
      modal.classList.remove('show')
    }
    toast('Receipt deleted', 'success')
  } catch (error) {
    console.error('Failed to delete receipt:', error)
    toast('Failed to delete receipt', 'error')
  }
}

/**
 * Open transaction edit modal
 */
export function openTransactionModal(transactionId: number): void {
  import('./api.js').then(async ({ api }) => {
    const transactions = await api.getTransactions()
    const tx = transactions.find((t) => t.id === transactionId)
    if (tx === undefined) return

    const modal = document.getElementById('tx-modal')
    const title = document.getElementById('tx-modal-title')
    const descInput = document.getElementById('tx-description') as HTMLInputElement | null
    const amountInput = document.getElementById('tx-amount') as HTMLInputElement | null
    const dateInput = document.getElementById('tx-date') as HTMLInputElement | null
    const categoryInput = document.getElementById('tx-category') as HTMLSelectElement | null
    const meansInput = document.getElementById('tx-means') as HTMLSelectElement | null
    const notesInput = document.getElementById('tx-notes') as HTMLInputElement | null
    const receiptInput = document.getElementById('tx-receipt') as HTMLInputElement | null
    const idInput = document.getElementById('tx-id') as HTMLInputElement | null
    const typeSelector = document.getElementById('tx-type-selector')

    if (
      modal === null ||
      title === null ||
      descInput === null ||
      amountInput === null ||
      dateInput === null ||
      categoryInput === null ||
      typeSelector === null
    ) {
      return
    }

    title.textContent = 'Edit Transaction'
    idInput!.value = tx.id.toString()
    descInput.value = tx.description
    amountInput.value = tx.amount.toString()
    dateInput.value = tx.date

    // Set category
    Array.from(categoryInput.options).forEach((opt) => {
      opt.selected = opt.value === tx.category_name
    })

    // Set type
    const typeButtons = typeSelector.querySelectorAll('button')
    typeButtons.forEach((btn) => {
      btn.classList.remove('active')
      if (btn.dataset.selectedType === tx.type) {
        btn.classList.add('active')
      }
    })

    if (meansInput !== null) meansInput.value = tx.beneficiary ?? tx.payor ?? ''
    if (notesInput !== null) notesInput.value = ''
    if (receiptInput !== null) receiptInput.value = ''

    modal.classList.add('show')
  })
}

/**
 * Close transaction modal
 */
export function closeTransactionModal(): void {
  const modal = document.getElementById('tx-modal')
  if (modal !== null) {
    modal.classList.remove('show')
  }
}

/**
 * Handle modal action for event delegation
 */
export function handleModalAction(action: string, arg?: unknown): void {
  switch (action) {
    case 'modal:close': {
      const closeModals = document.querySelectorAll('.modal-overlay.show')
      closeModals.forEach((m) => {
        m.classList.remove('show')
      })
      break
    }

    case 'tx-modal:close':
      closeTransactionModal()
      break

    case 'receipt-modal:close': {
      const receiptModal = document.getElementById('receipt-modal')
      if (receiptModal !== null) {
        receiptModal.classList.remove('show')
      }
      break
    }

    case 'receipt-modal':
      if (arg !== null && typeof arg === 'object') {
        openReceiptModal(arg as ReceiptData)
      }
      break

    case 'transactions:setType': {
      const setType =
        typeof window.transactionsSetType === 'function'
          ? window.transactionsSetType
          : (_newType: string) => {
              const txComponent = document.querySelector(
                '[data-page="transactions"]'
              )
              if (txComponent !== null && txComponent.setType !== undefined) {
                txComponent.setType(_newType)
              }
            }
      setType(arg as string)
      break
    }
  }
}

/**
 * Open receipt modal with data
 */
export function openReceiptModal(receipt: ReceiptData): void {
  const modal = document.getElementById('receipt-modal')
  const img = document.getElementById('receipt-view-image') as HTMLImageElement | null
  const meta = document.getElementById('receipt-meta')
  const downloadLink = document.getElementById('receipt-download-link') as HTMLAnchorElement | null

  if (modal !== null && img !== null && meta !== null && receipt.id !== 0) {
    // Set image src
    img.src = `/api/receipts/${receipt.id}/file`

    // Populate meta info
    meta.innerHTML = `
      <div class="receipt-meta-item">
        <span class="receipt-meta-label">File Name</span>
        <span>${escapeHtml(receipt.original_name)}</span>
      </div>
      <div class="receipt-meta-item">
        <span class="receipt-meta-label">File Type</span>
        <span>${escapeHtml(receipt.file_type)}</span>
      </div>
      <div class="receipt-meta-item">
        <span class="receipt-meta-label">Size</span>
        <span>${(receipt.file_size / 1024).toFixed(2)} KB</span>
      </div>
      <div class="receipt-meta-item">
        <span class="receipt-meta-label">Uploaded</span>
        <span>${new Date(receipt.uploaded_at).toLocaleString()}</span>
      </div>
    `

    // Set download link
    if (downloadLink !== null) {
      downloadLink.href = `/api/receipts/${receipt.id}/file`
      downloadLink.download = receipt.original_name
    }

    modal.classList.add('show')
  }
}

/**
 * Toast notification helper (from api module)
 */
const apiModule = await import('./api.js')
export function toast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  apiModule.toast(message, type)
}

/**
 * HTML escape helper (from api module)
 */
export function escapeHtml(str: string): string {
  return apiModule.escapeHtml(str)
}

// Export window-compatible handlers for legacy code
export const handlers = {
  'receipt-modal': (arg: unknown) => {
    handleModalAction('receipt-modal', arg)
  },
  'transactions:setType': (arg: string) => {
    handleModalAction('transactions:setType', arg)
  },
}

export const receipts = {
  handleFileSelect: (event: Event) => {
    handleReceiptFileSelect(event)
  },
  remove: () => {
    removeReceiptPreview()
  },
  delete: (receiptId: number) => deleteReceipt(receiptId),
}

export const transactions = {
  handleReceiptFileSelect: (event: Event) => {
    handleReceiptFileSelect(event)
  },
  openEditModal: (transactionId: number) => {
    openTransactionModal(transactionId)
  },
  closeModal: () => {
    closeTransactionModal()
  },
  save: async () => {
    // Placeholder - would call actual save logic
    toast('Transaction saved', 'success')
  },
  setType: (type: string) => {
    console.info(`Set type to: ${type}`)
  },
  removeReceipt: () => {
    removeReceiptPreview()
  },
}
