/**
 * Global Window Type Declarations
 */

/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string
  const __GIT_SHA__: string

  interface Window {
    transactionsSetType?: (type: string) => void
    transactionsLoad?: () => Promise<void>
    transactionsLoadType?: () => Promise<void>
    transactionsSetFilterType?: (type: string) => void
    transactionsSetFilterMonth?: (month: string) => void
    transactionsSetSearchTerm?: (term: string) => void
    transactionsSetSelectedTxId?: (id: number | null) => void
    transactionsSetLoading?: (loading: boolean) => void
    transactionsSave?: () => Promise<void>
  }
}

interface ImportMetaEnv {
  readonly VITE_DEFAULT_STORAGE?: string
  readonly VITE_SITE_DOMAIN?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_CORS_ORIGINS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

export {}
