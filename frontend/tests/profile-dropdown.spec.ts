import { expect, test } from '@playwright/test'

/**
 * Profile dropdown integration tests.
 * Tests for duplicate profiles, selection behavior, and IndexedDB integrity.
 * Selectors use data-test-id hooks (see tests/README.md); `[data-profile-id]` is a stable data
 * attribute, not copy, so it stays.
 */

test('profile dropdown - no duplicates in the seeded demo state @smoke', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  // Serverless mode; stub the destructive backend routes so a parallel run can't wipe shared data.
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })
  await page.route('**/api/profile/data', (route) =>
    route.fulfill({ status: 200, json: { ok: true } })
  )
  await page.route('**/api/profiles/reseed-demo', (route) =>
    route.fulfill({ status: 200, json: { ok: true } })
  )

  await page.goto('http://127.0.0.1:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

  // Open the profile dropdown.
  const dropdownBtn = page.getByTestId('profile-dropdown-btn')
  await expect(dropdownBtn).toBeVisible({ timeout: 15000 })
  await dropdownBtn.click()
  await page.waitForTimeout(500)

  const profileItems = page.locator('[data-profile-id]')
  const count = await profileItems.count()
  const profileIds: number[] = []
  const profileNames: string[] = []
  for (let i = 0; i < count; i++) {
    profileIds.push(Number(await profileItems.nth(i).getAttribute('data-profile-id')))
    profileNames.push((await profileItems.nth(i).locator('span').first().textContent()) || '')
  }

  // No duplicate profile IDs or names in the dropdown.
  expect(new Set(profileIds).size).toBe(profileIds.length)
  const nameCounts = new Map<string, number>()
  for (const name of profileNames) nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
  for (const [, c] of nameCounts) expect(c).toBe(1)
})

test('profile dropdown - create profile and check no duplicates @smoke', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://127.0.0.1:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

  const dropdownBtn = page.getByTestId('profile-dropdown-btn')
  await expect(dropdownBtn).toBeVisible({ timeout: 15000 })
  await dropdownBtn.click()
  await page.waitForTimeout(500)

  const initialCount = await page.locator('[data-profile-id]').count()

  // Open the create-profile modal and submit a uniquely named profile.
  await page.getByTestId('profile-create-item').click()
  const modal = page.getByTestId('profile-modal')
  await expect(modal).toBeVisible({ timeout: 5000 })
  const newName = `Test Profile ${Date.now()}`
  await page.getByTestId('profile-name-input').fill(newName)
  await page.getByTestId('profile-create-submit').click()
  await page.waitForTimeout(1500)

  // Reopen and confirm no duplicate IDs, and that a profile was added.
  await dropdownBtn.click()
  await page.waitForTimeout(500)
  const items = page.locator('[data-profile-id]')
  const finalCount = await items.count()
  expect(finalCount).toBeGreaterThanOrEqual(initialCount + 1)
  const ids: number[] = []
  for (let i = 0; i < finalCount; i++) {
    ids.push(Number(await items.nth(i).getAttribute('data-profile-id')))
  }
  expect(new Set(ids).size).toBe(ids.length)
})

test('profile dropdown - select profile and reopen shows no duplicates @smoke', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://127.0.0.1:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

  const dropdownBtn = page.getByTestId('profile-dropdown-btn')
  await expect(dropdownBtn).toBeVisible({ timeout: 15000 })
  await dropdownBtn.click()
  await page.waitForTimeout(500)

  const profileItems = page.locator('[data-profile-id]')
  const profileCount = await profileItems.count()
  if (profileCount < 2) return // not enough profiles to exercise selection

  await profileItems.nth(1).locator('span').first().click()
  await page.waitForTimeout(1000)

  await dropdownBtn.click()
  await page.waitForTimeout(500)
  const reopened = page.locator('[data-profile-id]')
  const reopenedCount = await reopened.count()
  const ids: number[] = []
  for (let i = 0; i < reopenedCount; i++) {
    ids.push(Number(await reopened.nth(i).getAttribute('data-profile-id')))
  }
  expect(new Set(ids).size).toBe(ids.length)
  expect(new Set(ids).size).toBe(profileCount)
})

test('profile dropdown - IndexedDB integrity check @smoke', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://127.0.0.1:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  const dbCheck = await page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    const financeDb = dbs.find((db) => db.name === 'finance')
    if (!financeDb) return { error: 'No finance database found' }

    return new Promise((resolve) => {
      const request = indexedDB.open('finance', 5)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('profiles', 'readonly')
        const getAll = tx.objectStore('profiles').getAll()
        getAll.onsuccess = () => {
          const profiles = getAll.result
          const ids = profiles.map((p: { id: number }) => p.id)
          resolve({ totalProfiles: profiles.length, uniqueIds: new Set(ids).size })
        }
        getAll.onerror = () => resolve({ error: 'Failed to get profiles' })
      }
      request.onerror = () => resolve({ error: 'Failed to open database' })
    })
  })

  const result = dbCheck as { totalProfiles?: number; uniqueIds?: number; error?: string }
  if (typeof result.totalProfiles === 'number') {
    expect(result.uniqueIds).toBe(result.totalProfiles)
  }
})

test('profile dropdown - no key/duplicate console errors @smoke', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))

  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://127.0.0.1:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)

  const dropdownBtn = page.getByTestId('profile-dropdown-btn')
  await expect(dropdownBtn).toBeVisible({ timeout: 15000 })
  await dropdownBtn.click()
  await page.waitForTimeout(1000)

  const keyErrors = errors.filter(
    (e) => e.includes('key') || e.includes('duplicate') || e.includes('unique')
  )
  expect(keyErrors).toHaveLength(0)
})
