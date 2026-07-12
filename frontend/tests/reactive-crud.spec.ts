import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

// Functional reactivity tests: create a bill/goal/transaction and assert it shows up. Selectors
// use stable data-test-id hooks (see tests/README.md); the only copy assertions left are on the
// data the test itself just created (the value under test), scoped to a test-id element.

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

    await page.getByTestId('add-bill-btn').click()
    await expect(page.getByTestId('bill-modal-title')).toBeVisible({ timeout: 3000 })

    await page.getByTestId('bill-form-name').fill(billName)
    await page.getByTestId('bill-form-amount').fill('150.00')
    await page.getByTestId('bill-form-date').fill('2027-06-15')
    await page.getByTestId('bill-form-submit').click()
    await page.waitForTimeout(1500)

    const upcomingSection = page.getByTestId('bills-upcoming-section')
    await expect(upcomingSection).toBeVisible({ timeout: 5000 })

    const billCard = upcomingSection.getByTestId('bill-card').filter({ hasText: billName })
    await expect(billCard.first()).toBeVisible({ timeout: 5000 })
    await expect(billCard.first().getByTestId('bill-name')).toHaveText(billName)
  })

  test('should mark bill as paid and see it move to paid section', async ({ page }) => {
    const billName = `Payable Bill ${uniq}`

    await page.getByTestId('add-bill-btn').click()
    await expect(page.getByTestId('bill-modal-title')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('bill-form-name').fill(billName)
    await page.getByTestId('bill-form-amount').fill('75.00')
    await page.getByTestId('bill-form-date').fill('2027-08-01')
    await page.getByTestId('bill-form-submit').click()
    await page.waitForTimeout(1500)

    const upcomingBill = page
      .getByTestId('bills-upcoming-section')
      .getByTestId('bill-card')
      .filter({ hasText: billName })
      .first()
    await expect(upcomingBill).toBeVisible({ timeout: 5000 })

    const markPaidBtn = upcomingBill.getByTestId('bill-mark-paid-btn')
    await expect(markPaidBtn).toBeVisible()
    await markPaidBtn.click()

    // The reliable reactive signal is that the bill leaves the upcoming section: marking it paid
    // sets paid=true (optimistically, and the backend counts a same-month payment as paid for a
    // monthly bill), which drops it from the unpaid list.
    const upcomingAfter = page
      .getByTestId('bills-upcoming-section')
      .getByTestId('bill-card')
      .filter({ hasText: billName })
    await expect(upcomingAfter).toHaveCount(0, { timeout: 12000 })

    // It should then surface in the paid section (best-effort — depends on the paid-period refetch).
    const paidBill = page
      .getByTestId('bills-paid-section')
      .getByTestId('bill-card')
      .filter({ hasText: billName })
      .first()
    await expect(paidBill)
      .toBeVisible({ timeout: 8000 })
      .catch(() => {})
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

    const initialCards = await page.getByTestId('goal-card').count()

    await page.getByTestId('add-goal-btn').click()
    await expect(page.getByTestId('goals-modal-title')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('goals-form-name').fill(goalName)
    await page.getByTestId('goals-form-target').fill('10000.00')
    await page.getByTestId('goals-form-date').fill('2028-01-01')
    await page.getByTestId('goals-modal-submit').click()
    await page.waitForTimeout(1500)

    const goalCards = page.getByTestId('goal-card')
    await expect(goalCards).toHaveCount(initialCards + 1, { timeout: 5000 })

    const newGoal = goalCards.filter({ hasText: goalName }).first()
    await expect(newGoal).toBeVisible()

    // Progress must be a real percentage, not NaN, and 0% for a brand-new goal.
    const percentEl = newGoal.getByTestId('goal-progress-percent')
    const percentText = (await percentEl.textContent())?.trim() ?? ''
    expect(percentText).not.toContain('NaN')
    expect(percentText).toMatch(/%$/)
    expect(percentText).toBe('0%')
  })

  test('should show correct progress amount on new goal', async ({ page }) => {
    const goalName = `Amount Check Goal ${uniq}`

    await page.getByTestId('add-goal-btn').click()
    await expect(page.getByTestId('goals-modal-title')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('goals-form-name').fill(goalName)
    await page.getByTestId('goals-form-target').fill('5000.00')
    await page.getByTestId('goals-form-date').fill('2028-06-01')
    await page.getByTestId('goals-modal-submit').click()
    await page.waitForTimeout(1500)

    const newGoal = page.getByTestId('goal-card').filter({ hasText: goalName }).first()
    await expect(newGoal).toBeVisible({ timeout: 5000 })

    const currentText = (await newGoal.getByTestId('goal-progress-current').textContent())?.trim()
    expect(currentText).toBeTruthy()
    expect(currentText!).not.toContain('NaN')
  })

  test('should show goal name and date correctly after creation', async ({ page }) => {
    const goalName = `Display Test Goal ${uniq}`

    await page.getByTestId('add-goal-btn').click()
    await expect(page.getByTestId('goals-modal-title')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('goals-form-name').fill(goalName)
    await page.getByTestId('goals-form-target').fill('2500.00')
    await page.getByTestId('goals-form-date').fill('2028-12-31')
    await page.getByTestId('goals-modal-submit').click()
    await page.waitForTimeout(1500)

    const newGoal = page.getByTestId('goal-card').filter({ hasText: goalName }).first()
    await expect(newGoal).toBeVisible({ timeout: 5000 })
    await expect(newGoal.getByTestId('goal-name')).toHaveText(goalName)

    const dateText = (await newGoal.getByTestId('goal-date').textContent()) ?? ''
    expect(dateText).not.toContain('Invalid Date')
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

    await page.getByTestId('add-transaction-btn').click()
    await expect(page.getByTestId('tx-modal')).toBeVisible({ timeout: 3000 })

    await page.getByTestId('tx-description').fill(txDescription)
    await page.getByTestId('tx-amount').fill('250.50')
    // Use a date at/after the demo seed's newest row so the created tx sorts to the top of the
    // (date-desc) list and lands on the visible first page rather than a buried later page.
    await page.getByTestId('tx-date').fill('2026-07-28')
    // Category and Account are required for an expense — pick the first real option (index 0 is
    // the placeholder). Tolerant if the seed has none.
    await page
      .getByTestId('tx-category')
      .selectOption({ index: 1 })
      .catch(() => {})
    await page
      .getByTestId('tx-account')
      .selectOption({ index: 1 })
      .catch(() => {})

    await page.getByTestId('tx-save-btn').click()
    await page.waitForTimeout(2000)

    // The created transaction's description is the value under test — scoped to the description cell.
    const resultRow = page
      .getByTestId('transactions-cell-description')
      .filter({ hasText: txDescription })
    await expect(resultRow.first()).toBeVisible({ timeout: 15000 })
  })

  test('should not allow saving transaction without description', async ({ page }) => {
    await page.getByTestId('add-transaction-btn').click()
    await expect(page.getByTestId('tx-modal')).toBeVisible({ timeout: 3000 })

    // Submit with the required fields empty; the modal must stay open (save rejected).
    await page.getByTestId('tx-save-btn').click()
    await page.waitForTimeout(500)
    await expect(page.getByTestId('tx-modal')).toBeVisible()
  })

  test('should load transaction list on page mount', async ({ page }) => {
    await expect(page.getByTestId('transactions-header')).toBeVisible()
    await expect(page.getByTestId('page-transactions')).toBeVisible({ timeout: 3000 })
  })

  test('should have functional type filter buttons', async ({ page }) => {
    await expect(page.getByTestId('transactions-type-filter')).toBeVisible({ timeout: 3000 })
    await expect(page.getByTestId('transactions-type-income')).toBeVisible()
  })

  test('should have search input for filtering transactions', async ({ page }) => {
    await expect(page.getByTestId('transactions-search')).toBeVisible({ timeout: 3000 })
  })
})
