import { expect, test } from '@playwright/test'

/**
 * Profile dropdown integration tests.
 * Tests for duplicate profiles, selection behavior, and IndexedDB integrity.
 */

test('profile dropdown - no duplicates after reseed and create', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  // Set up serverless mode and clear existing state
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://localhost:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

  // Navigate to settings to clear all data first
  await page.goto('http://localhost:3800/#settings', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(1000)

  // Click "Delete All Data" in Danger Zone
  const deleteBtn = page.locator('button', { hasText: 'Delete All Data' })
  if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await deleteBtn.click()
    // Confirm dialog
    const confirmBtn = page.locator('[data-test-id="confirm-dialog-confirm"]')
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click()
      await page.waitForTimeout(1500)
    }
  }

  // Reseed demo data
  const reseedBtn = page.locator('button', { hasText: 'Reseed Data' })
  if (await reseedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await reseedBtn.click()
    await page.waitForTimeout(2000)
  }

  // Reload the page to get fresh state
  await page.goto('http://localhost:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  // Open the profile dropdown
  const dropdownBtn = page.locator(`[class*="profileDropdownBtn"]`)
  if (await dropdownBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dropdownBtn.click()
    await page.waitForTimeout(1000)
  }

  // Find all profile items with data-profile-id
  const profileItems = page.locator('[data-profile-id]')
  const count = await profileItems.count()
  const profileIds: number[] = []
  const profileNames: string[] = []

  for (let i = 0; i < count; i++) {
    const id = await profileItems.nth(i).getAttribute('data-profile-id')
    const name = await profileItems.nth(i).locator('span').first().textContent()
    profileIds.push(Number(id))
    profileNames.push(name || '')
  }

  console.log('Profile IDs in dropdown:', profileIds)
  console.log('Profile names in dropdown:', profileNames)

  // Check for duplicate IDs in the dropdown
  const uniqueIds = new Set(profileIds)
  expect(uniqueIds.size).toBe(profileIds.length)

  // Verify no duplicate names
  const nameCounts = new Map<string, number>()
  for (const name of profileNames) {
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
  }
  for (const [name, c] of nameCounts) {
    expect(c).toBe(1)
  }
})

test('profile dropdown - create profile and check no duplicates', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://localhost:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  // Open the profile dropdown
  const dropdownBtn = page.locator(`[class*="profileDropdownBtn"]`)
  if (await dropdownBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dropdownBtn.click()
    await page.waitForTimeout(500)
  }

  // Count initial profiles
  const initialCount = await page.locator('[data-profile-id]').count()
  console.log('Initial profile count:', initialCount)

  // Close dropdown by clicking elsewhere
  await page.locator('body').click({ position: { x: 10, y: 10 } })
  await page.waitForTimeout(300)

  // Click "Create Profile" in the dropdown
  if (await dropdownBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dropdownBtn.click()
    await page.waitForTimeout(500)
  }
  const createBtn = page.locator(`[class*="profileDropdownItem"]`, { hasText: 'Create Profile' })
  if (await createBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await createBtn.click()
    await page.waitForTimeout(500)
  }

  // Fill in profile name
  const nameInput = page.locator('input[placeholder="Enter profile name"]')
  if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nameInput.fill('Test Profile ' + Date.now())
    await page.locator('button', { hasText: 'Create' }).click()
    await page.waitForTimeout(2000)
  }

  // Reopen dropdown and check for duplicates
  if (await dropdownBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dropdownBtn.click()
    await page.waitForTimeout(500)
  }

  const profileItems = page.locator('[data-profile-id]')
  const finalCount = await profileItems.count()
  const ids: number[] = []
  for (let i = 0; i < finalCount; i++) {
    const id = await profileItems.nth(i).getAttribute('data-profile-id')
    ids.push(Number(id))
  }

  console.log('Profile IDs after create:', ids)

  // No duplicate IDs
  const uniqueIds = new Set(ids)
  expect(uniqueIds.size).toBe(ids.length)
})

test('profile dropdown - select profile and reopen shows no duplicates', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://localhost:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  // Open dropdown
  const dropdownBtn = page.locator(`[class*="profileDropdownBtn"]`)
  if (await dropdownBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dropdownBtn.click()
    await page.waitForTimeout(500)
  }

  const profileItems = page.locator('[data-profile-id]')
  const profileCount = await profileItems.count()
  if (profileCount < 2) {
    console.log('Not enough profiles to test selection, skipping')
    return
  }

  // Click the second profile's name span to select it
  const secondProfileName = profileItems.nth(1).locator('span').first()
  const secondProfileId = await profileItems.nth(1).getAttribute('data-profile-id')
  console.log('Selecting profile ID:', secondProfileId)

  if (await secondProfileName.isVisible({ timeout: 2000 }).catch(() => false)) {
    await secondProfileName.click()
    await page.waitForTimeout(1000)
  }

  // Reopen dropdown
  if (await dropdownBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dropdownBtn.click()
    await page.waitForTimeout(500)
  }

  // Check for duplicates
  const reopenedItems = page.locator('[data-profile-id]')
  const reopenedCount = await reopenedItems.count()
  const ids: number[] = []
  for (let i = 0; i < reopenedCount; i++) {
    const id = await reopenedItems.nth(i).getAttribute('data-profile-id')
    ids.push(Number(id))
  }

  console.log('Profile IDs after select and reopen:', ids)

  const uniqueIds = new Set(ids)
  expect(uniqueIds.size).toBe(ids.length)
  expect(uniqueIds.size).toBe(profileCount)
})

test('profile dropdown - IndexedDB integrity check', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://localhost:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  // Access IndexedDB directly from the page and check for duplicates
  const dbCheck = await page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    const financeDb = dbs.find((db) => db.name === 'finance')
    if (!financeDb) return { error: 'No finance database found' }

    return new Promise((resolve) => {
      const request = indexedDB.open('finance', 5)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('profiles', 'readonly')
        const store = tx.objectStore('profiles')
        const getAll = store.getAll()
        getAll.onsuccess = () => {
          const profiles = getAll.result
          const ids = profiles.map((p: any) => p.id)
          const names = profiles.map((p: any) => p.name)
          const idSet = new Set(ids)
          resolve({
            totalProfiles: profiles.length,
            uniqueIds: idSet.size,
            ids,
            names,
            hasDuplicates: profiles.length !== idSet.size,
          })
        }
        getAll.onerror = () => resolve({ error: 'Failed to get profiles' })
      }
      request.onerror = () => resolve({ error: 'Failed to open database' })
    })
  })

  console.log('IndexedDB check:', JSON.stringify(dbCheck))

  // If IndexedDB has duplicates, that's the root cause
  if (dbCheck && typeof dbCheck === 'object' && 'hasDuplicates' in dbCheck) {
    expect(dbCheck.hasDuplicates).toBe(false)
  }
})

test('profile dropdown - console errors check', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))

  await page.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'serverless')
  })

  await page.goto('http://localhost:3800/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)

  // Open dropdown
  const dropdownBtn = page.locator(`[class*="profileDropdownBtn"]`)
  if (await dropdownBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await dropdownBtn.click()
    await page.waitForTimeout(1000)
  }

  // Count profiles
  const count = await page.locator('[data-profile-id]').count()
  console.log('Profile count:', count)
  console.log('Console errors:', errors)

  // Check for key errors
  const keyErrors = errors.filter((e) =>
    e.includes('key') || e.includes('duplicate') || e.includes('unique')
  )
  expect(keyErrors).toHaveLength(0)
})
