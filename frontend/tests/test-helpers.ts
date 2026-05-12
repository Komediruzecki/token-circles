/**
 * Test helpers for Playwright tests
 */

// Track whether the context has been authenticated already
let contextAuthSetup = new WeakMap<any, boolean>()

/**
 * Login to the application
 * Creates a real backend session via API login, then sets localStorage.
 * Skips the backend rate limiter for tests and reuses auth state.
 */
export async function login(page: any) {
  const ctx = page.context()
  try {
    // Skip re-login if this context already has authentication + localStorage set up
    if (contextAuthSetup.has(ctx) && contextAuthSetup.get(ctx)) {
      await page.goto('http://localhost:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
      return
    }

    // Authenticate with backend, skipping rate limiter (header is recognized by test/dev backend)
    const loginRes = await ctx.request.post('http://localhost:3800/api/auth/login', {
      data: { username: 'maff', password: 'add2' },
      headers: { 'x-skip-ratelimit': 'true' },
    })
    if (!loginRes.ok()) {
      console.error('Login failed:', loginRes.status(), await loginRes.text())
      throw new Error(`Login returned ${loginRes.status()}`)
    }
    // addInitScript must be called BEFORE navigation so localStorage is set when app initializes
    await ctx.addInitScript(() => {
      localStorage.setItem('currentProfileId', '1')
      localStorage.setItem('darkMode', 'false')
      localStorage.setItem('finance_storage_mode', 'self-hosted')
    })
    contextAuthSetup.set(ctx, true)
    await page.goto('http://localhost:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
  } catch (error) {
    console.error('Login failed:', error)
    throw error
  }
}

/**
 * Navigate to a hash route and wait for content to load
 */
export async function navigateToRoute(page: any, route: string) {
  await page.goto(`http://localhost:3800/#${route}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(500)
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
}

/**
 * Helper to find elements by data-test-id
 * Uses data-test-id attribute (matches source code)
 */
export function getByTestId(page: any, testId: string, options: any = {}) {
  return page.locator(`[data-test-id="${testId}"]`, options)
}

/**
 * Helper to find multiple elements by data-test-id
 */
export function getByTestIdMulti(page: any, testId: string, options: any = {}) {
  return page.locator(`[data-test-id="${testId}"]`, options)
}
