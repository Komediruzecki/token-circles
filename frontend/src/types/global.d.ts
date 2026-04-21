/**
 * Global Window Type Declarations
 * Declares handlers and utilities exposed to window for event delegation
 */

interface ReceiptHandler {
  handleFileSelect(event: Event): void
  remove(): void
  delete(receiptId: number): Promise<void>
}

interface TransactionsHandler {
  handleReceiptFileSelect(event: Event): void
  openEditModal(transactionId: number): void
  closeModal(): void
  save(): Promise<void>
  setType(type: string): void
  handleReceiptFileSelect(event: Event): void
  removeReceipt(): void
}

interface HandlersArg {
  [key: string]: string | number | object | null | undefined
}

declare global {
  interface Window {
    receipts: ReceiptHandler
    transactions: TransactionsHandler
    transactionsSetType: (type: string) => void
    transactionsLoad: () => Promise<void>
    transactionsLoadType?: () => Promise<void>
    transactionsSetFilterType: (type: string) => void
    transactionsSetFilterMonth: (month: string) => void
    transactionsSetSearchTerm: (term: string) => void
    transactionsSetSelectedTxId: (id: number | null) => void
    transactionsSetLoading: (loading: boolean) => void
    handlers: Record<string, (arg: any) => void>
    transactions: TransactionsHandler
    transactionsSave: () => Promise<void>
  }
}

export {}