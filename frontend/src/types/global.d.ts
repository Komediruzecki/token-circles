/**
 * Global Window Type Declarations
 */

/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string
  const __GIT_SHA__: string
  /** False under `vite dev`, where no dist/sw.js exists to register. */
  const __SW_ENABLED__: boolean

  interface Window {
    /**
     * Set by the one-time service-worker reset in index.html (see the sw-cleanup plugin in
     * vite.config.ts). Registration waits on it, so an unregister cannot resolve after — and
     * quietly undo — the register that follows it.
     */
    __SW_CLEANUP__?: Promise<unknown>
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
  readonly VITE_API_URL?: string
  readonly VITE_CORS_ORIGINS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

export {}
