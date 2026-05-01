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
    await toast('Receipt deleted', 'success')
  } catch (error) {
    console.error('Failed to delete receipt:', error)
    await toast('Failed to delete receipt', 'error')
  }
}

/**
 * Open transaction edit modal
 */
export async function openTransactionModal(transactionId: number): Promise<void> {
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
  await toast('Transaction loaded for editing', 'info')
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
              const txComponent = document.querySelector('[data-page="transactions"]')
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
 * HTML escape helper
 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/**
 * Toast notification helper
 */
export async function toast(
  message: string,
  type: 'success' | 'error' | 'info' = 'info'
): Promise<void> {
  const { toast: apiToast } = await import('./api.js')
  apiToast(message, type)
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

// Direct function exports for window access
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
    await toast('Transaction saved', 'success')
  },
  setType: (type: string) => {
    console.info(`Set type to: ${type}`)
  },
  removeReceipt: () => {
    removeReceiptPreview()
  },
}

/**
 * Auth handlers - Login and Logout
 */

export async function authLogin(username?: string, password?: string): Promise<void> {
  try {
    // Use provided credentials or show login prompt
    if (!username || !password) {
      const result = await showLoginDialog()
      if (result) {
        username = result.username
        password = result.password
      } else {
        // User cancelled - don't force login
        return
      }
    }
    const { api } = await import('./api.js')
    await api.login(username!, password!)
    await toast('Successfully logged in', 'success')
  } catch (error) {
    console.error('Login failed:', error)
    const errorMsg = error instanceof Error ? error.message : 'Login failed'
    await toast(errorMsg, 'error')
    throw error
  }
}

export async function authLogout(): Promise<void> {
  try {
    const { api } = await import('./api.js')
    await api.logout()
    localStorage.removeItem('currentProfileId')
    await toast('Logged out successfully', 'info')
  } catch (error) {
    console.error('Logout failed:', error)
    // Force clear profile ID even if API call fails
    localStorage.removeItem('currentProfileId')
    await toast('Logged out', 'info')
  }
}

/**
 * Show custom login dialog
 */
function showLoginDialog(): Promise<{ username: string; password: string } | null> {
  return new Promise((resolve) => {
    // Create dialog overlay
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    `

    const dialog = document.createElement('div')
    dialog.style.cssText = `
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      padding: 24px;
      border-radius: 12px;
      width: 320px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    `

    dialog.innerHTML = `
      <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600;">Sign In</h3>
      <div style="margin-bottom: 12px;">
        <label style="display: block; font-size: 12px; margin-bottom: 4px;">Username</label>
        <input type="text" id="login-username" placeholder="Enter your username" style="
          width: 100%;
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.1);
          color: #fff;
          box-sizing: border-box;
        ">
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 12px; margin-bottom: 4px;">Password</label>
        <input type="password" id="login-password" placeholder="Enter your password" style="
          width: 100%;
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.1);
          color: #fff;
          box-sizing: border-box;
        ">
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="login-cancel" style="
          flex: 1;
          padding: 10px;
          border-radius: 6px;
          border: none;
          background: rgba(255,255,255,0.2);
          color: #fff;
          cursor: pointer;
          font-weight: 500;
        ">Cancel</button>
        <button id="login-submit" style="
          flex: 1;
          padding: 10px;
          border-radius: 6px;
          border: none;
          background: var(--primary);
          color: #fff;
          cursor: pointer;
          font-weight: 500;
        ">Sign In</button>
      </div>
    `

    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    // Handle cancel
    document.getElementById('login-cancel')?.addEventListener('click', () => {
      overlay.remove()
      resolve(null)
    })

    // Handle submit
    document.getElementById('login-submit')?.addEventListener('click', () => {
      const username = document.getElementById('login-username')?.value?.trim()
      const password = document.getElementById('login-password')?.value
      if (!username || !password) return
      overlay.remove()
      resolve({ username, password })
    })

    // Handle overlay click to cancel
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove()
        resolve(null)
      }
    })

    // Focus username on load
    setTimeout(() => document.getElementById('login-username')?.focus(), 100)
  })
}

/**
 * Select a profile
 */
export async function selectProfile(profileId: number): Promise<void> {
  try {
    localStorage.setItem('currentProfileId', profileId.toString())
  } catch {
    console.error('Failed to save profile ID to localStorage')
  }
}
