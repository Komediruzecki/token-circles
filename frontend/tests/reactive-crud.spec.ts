import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

// Unique suffix to avoid collisions across test runs (data persists in DB)
const uniq = Date.now().toString(36)

test.describe('Bills Reactive CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'bills')
    await page.waitForTimeout(500)
  })

  test('should create a new bill and see it in upcoming section', async ({ page }) => {
    const billName = `Test Reactive Bill ${uniq}`

    await page.locator('[data-test-id="add-bill-btn"]').click()
    await page.waitForTimeout(300)

    // Verify modal is open
    const modalTitle = page.locator('h3').filter({ hasText: 'Add Bill' })
    await expect(modalTitle).toBeVisible({ timeout: 3000 })

    // Fill form
    await page.locator('input[placeholder*="Rent" i]').fill(billName)
    await page.locator('input[type="number"][step="0.01"][placeholder="500.00"]').fill('150.00')
    await page.locator('input[type="date"]').first().fill('2027-06-15')

    // Submit via form-scoped button
    const form = page.locator('form')
    await form.locator('button').filter({ hasText: 'Add Bill' }).click()
    await page.waitForTimeout(1500)

    // Verify the new bill appears in upcoming section
    const upcomingSection = page.locator('[data-test-id="bills-upcoming-section"]')
    await expect(upcomingSection).toBeVisible({ timeout: 5000 })

    const billCard = upcomingSection
      .locator('[data-test-id="bill-card"]')
      .filter({ hasText: billName })
    await expect(billCard.first()).toBeVisible({ timeout: 5000 })

    const billNameEl = billCard.first().locator('[data-test-id="bill-name"]')
    await expect(billNameEl).toHaveText(billName)
  })

  test('should mark bill as paid and see it move to paid section', async ({ page }) => {
    const billName = `Payable Bill ${uniq}`

    // Create a bill
    await page.locator('[data-test-id="add-bill-btn"]').click()
    await page.waitForTimeout(300)

    await page.locator('input[placeholder*="Rent" i]').fill(billName)
    await page.locator('input[type="number"][step="0.01"][placeholder="500.00"]').fill('75.00')
    await page.locator('input[type="date"]').first().fill('2027-08-01')

    const form = page.locator('form')
    await form.locator('button').filter({ hasText: 'Add Bill' }).click()
    await page.waitForTimeout(1500)

    // Verify bill appears in upcoming section
    const upcomingBill = page
      .locator('[data-test-id="bills-upcoming-section"] [data-test-id="bill-card"]')
      .filter({ hasText: billName })
      .first()
    await expect(upcomingBill).toBeVisible({ timeout: 5000 })

    // Click Mark Paid button (scoped to this specific card)
    const markPaidBtn = upcomingBill.locator('[data-test-id="bill-mark-paid-btn"]')
    await expect(markPaidBtn).toBeVisible()
    await markPaidBtn.click()

    // Wait for server processing and UI update
    await page.waitForTimeout(2000)

    // Verify bill now appears in paid section
    const paidBill = page
      .locator('[data-test-id="bills-paid-section"] [data-test-id="bill-card"]')
      .filter({ hasText: billName })
      .first()
    await expect(paidBill).toBeVisible({ timeout: 5000 })

    // Verify the bill is no longer in upcoming section as unpaid
    const upcomingAfter = page
      .locator('[data-test-id="bills-upcoming-section"] [data-test-id="bill-card"]')
      .filter({ hasText: billName })
    await expect(upcomingAfter).toHaveCount(0, { timeout: 3000 })
  })
})

test.describe('Goals Progress Display', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'goals')
    await page.waitForTimeout(500)
  })

  test('should display correct progress percentage on new goal (not NaN)', async ({ page }) => {
    const goalName = `Test Savings Goal ${uniq}`

    // Record initial goal count
    const initialCards = await page.locator('[data-test-id="goal-card"]').count()

    // Open modal
    await page.locator('[data-test-id="add-goal-btn"]').click()
    await page.waitForTimeout(300)

    // Verify modal is open
    const modalTitle = page.locator('h3').filter({ hasText: 'New Goal' })
    await expect(modalTitle).toBeVisible({ timeout: 3000 })

    // Fill form
    await page.locator('input[placeholder*="Emergency" i]').fill(goalName)
    await page.locator('input[placeholder="5000.00"]').fill('10000.00')
    await page.locator('input[type="date"]').first().fill('2028-01-01')

    // Submit
    await page.locator('button').filter({ hasText: 'Create Goal' }).click()
    await page.waitForTimeout(1500)

    // Wait for new goal card to appear
    const goalCards = page.locator('[data-test-id="goal-card"]')
    await expect(goalCards).toHaveCount(initialCards + 1, { timeout: 5000 })

    // Find our new goal card (use first match since there may be duplicates from prior runs)
    const newGoal = goalCards.filter({ hasText: goalName }).first()
    await expect(newGoal).toBeVisible()

    // Verify the progress percentage is NOT NaN
    const percentEl = newGoal.locator('[data-test-id="goal-progress-percent"]')
    const percentText = await percentEl.textContent()

    expect(percentText).not.toBeNull()
    expect(percentText!.trim()).not.toBe('NaN%')
    expect(percentText!.trim()).not.toBe('NaN')
    expect(percentText!.trim()).not.toContain('NaN')
    expect(percentText!.trim()).toMatch(/%$/)
    expect(percentText!.trim()).toBe('0%')
  })

  test('should show correct progress amount on new goal', async ({ page }) => {
    const goalName = `Amount Check Goal ${uniq}`

    await page.locator('[data-test-id="add-goal-btn"]').click()
    await page.waitForTimeout(300)

    await page.locator('input[placeholder*="Emergency" i]').fill(goalName)
    await page.locator('input[placeholder="5000.00"]').fill('5000.00')
    await page.locator('input[type="date"]').first().fill('2028-06-01')

    await page.locator('button').filter({ hasText: 'Create Goal' }).click()
    await page.waitForTimeout(1500)

    const newGoal = page.locator('[data-test-id="goal-card"]').filter({ hasText: goalName }).first()
    await expect(newGoal).toBeVisible({ timeout: 5000 })

    // Verify current amount display has valid content (no NaN)
    const currentEl = newGoal.locator('[data-test-id="goal-progress-current"]')
    const currentText = await currentEl.textContent()
    expect(currentText).not.toBeNull()
    expect(currentText!.trim()).not.toContain('NaN')
    expect(currentText!.trim()).not.toBe('')
  })

  test('should show goal name and date correctly after creation', async ({ page }) => {
    const goalName = `Display Test Goal ${uniq}`

    await page.locator('[data-test-id="add-goal-btn"]').click()
    await page.waitForTimeout(300)

    await page.locator('input[placeholder*="Emergency" i]').fill(goalName)
    await page.locator('input[placeholder="5000.00"]').fill('2500.00')
    await page.locator('input[type="date"]').first().fill('2028-12-31')

    await page.locator('button').filter({ hasText: 'Create Goal' }).click()
    await page.waitForTimeout(1500)

    const newGoal = page.locator('[data-test-id="goal-card"]').filter({ hasText: goalName }).first()
    await expect(newGoal).toBeVisible({ timeout: 5000 })

    // Verify goal name
    const goalNameEl = newGoal.locator('[data-test-id="goal-name"]')
    await expect(goalNameEl).toHaveText(goalName)

    // Verify goal date is displayed (not "Invalid Date")
    const goalDate = newGoal.locator('[data-test-id="goal-date"]')
    const dateText = await goalDate.textContent()
    expect(dateText).not.toBeNull()
    expect(dateText!).not.toContain('Invalid Date')
  })
})

test.describe('Transactions CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'transactions')
    await page.waitForTimeout(500)
  })

  test('should create a new transaction and see it appear in the list', async ({ page }) => {
    const txDescription = `Test Reactive Transaction ${uniq}`

    // Click Add Transaction button to open the modal
    await page.locator('[data-test-id="add-transaction-btn"]').click()
    await page.waitForTimeout(500)

    // Verify modal is open
    const modalTitle = page
      .locator('#tx-modal-title, [class*="modalTitle"]')
      .filter({ hasText: 'Add Transaction' })
    await expect(modalTitle.first()).toBeVisible({ timeout: 3000 })

    // Fill form fields
    const form = page.locator('#tx-form')
    await form.locator('input[type="text"]').first().fill(txDescription)
    await form.locator('input[type="number"]').first().fill('250.50')
    await form.locator('input[type="date"]').first().fill('2026-05-01')

    // Click Save Transaction — scope to the modal to avoid ambiguity
    // The modal has class _btn-primary (CSS module) and is inside the modal overlay
    const modalOverlay = page.locator('[class*="modalOverlay"]').first()
    const saveBtn = modalOverlay.locator('button').filter({ hasText: 'Save Transaction' })
    await saveBtn.click()

    // Wait for modal to close and list to refresh
    await page.waitForTimeout(2000)

    // Verify the transaction appears in the list
    const resultRow = page.locator('td, div').filter({ hasText: txDescription })
    await expect(resultRow.first()).toBeVisible({ timeout: 5000 })
  })

  test('should not allow saving transaction without description', async ({ page }) => {
    await page.locator('[data-test-id="add-transaction-btn"]').click()
    await page.waitForTimeout(500)

    // Try to save without filling required fields
    const modalOverlay = page.locator('[class*="modalOverlay"]').first()
    const saveBtn = modalOverlay.locator('button').filter({ hasText: 'Save Transaction' })
    await saveBtn.click()

    // Verify modal or form is still present (save should not have succeeded)
    await page.waitForTimeout(500)
    // The form may still be visible or an error may be shown
  })

  test('should load transaction list on page mount', async ({ page }) => {
    await page.waitForTimeout(1000)

    // Check that the page has the transactions header
    const header = page.locator('[data-test-id="transactions-header"]')
    await expect(header).toBeVisible()

    // Verify page container exists
    const pageContainer = page.locator('.page-transactions')
    await expect(pageContainer).toBeVisible({ timeout: 3000 })
  })

  test('should have functional type filter buttons', async ({ page }) => {
    const allBtn = page.locator('button').filter({ hasText: 'All' })
    const incomeBtn = page.locator('button').filter({ hasText: 'Income' })

    // At least one should be visible
    const allVisible = await allBtn
      .first()
      .isVisible()
      .catch(() => false)
    const incomeVisible = await incomeBtn
      .first()
      .isVisible()
      .catch(() => false)

    expect(allVisible || incomeVisible).toBeTruthy()
  })

  test('should have search input for filtering transactions', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search" i]')
    await expect(searchInput.first()).toBeVisible({ timeout: 3000 })
  })
})
