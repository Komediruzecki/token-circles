/**
 * Global Window Type Declarations
 * Declares handlers and utilities exposed to window for event delegation
 */

import type { ReceiptHandler, TransactionsHandler } from './core/handlers.js'

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