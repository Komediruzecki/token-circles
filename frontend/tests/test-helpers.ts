/**
 * Test helpers for Playwright tests
 */

// Store the initial storage state (empty)
let initialContextState: any = null

/**
 * Initialize test context by setting up localStorage before page load
 */
export async function setupContext(page: any) {
  await page.goto('about:blank')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
}

/**
 * Get or create storage state for login
 */
export async function getContextState(page: any): Promise<any> {
  if (!initialContextState) {
    initialContextState = await page.context().storageState()
  }
  return { ...initialContextState }
}

/**
 * Login to the application
 * The app uses localStorage for authentication state (currentProfileId)
 */
export async function login(page: any) {
  try {
    // addInitScript must be called BEFORE navigation so localStorage is set when app initializes
    await page.context().addInitScript(() => {
      localStorage.setItem('currentProfileId', '1')
      localStorage.setItem('darkMode', 'false')
    })
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
  // addInitScript must be called BEFORE navigation so localStorage is set when app initializes
  await page.context().addInitScript(() => {
    localStorage.setItem('currentProfileId', '1')
    localStorage.setItem('darkMode', 'false')
  })
  await page.goto(`http://localhost:3800/#${route}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
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
