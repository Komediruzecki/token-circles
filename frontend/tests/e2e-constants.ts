/**
 * Shared between `playwright.config.ts`, the setup project and the helpers, so the port, the
 * credentials and the storage-state path cannot drift apart.
 *
 * (globalThis dance: the frontend tsconfig has no node types — vite/client only.)
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env

/** Override when another dev server already holds 3800; every consumer reads the same variable. */
export const E2E_PORT = Number(env?.E2E_PORT || 3800)
export const E2E_BASE = `http://127.0.0.1:${E2E_PORT}`

/** The Worker the vite dev proxy forwards /api to. */
export const E2E_API_PORT = Number(env?.E2E_API_PORT || 8787)
export const E2E_API_BASE = `http://127.0.0.1:${E2E_API_PORT}`

// A real account on a throwaway local database. Not a secret; nothing outside this suite can
// reach the database it exists in.
export const E2E_EMAIL = 'e2e@tokencircles.test'
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture account
export const E2E_PASSWORD = 'something-like-this'

/** The profile the shared dataset lives in. Specs needing isolation create their own. */
export const E2E_PROFILE = 'E2E Fixture'

export const STORAGE_STATE = 'tests/.auth/state.json'
