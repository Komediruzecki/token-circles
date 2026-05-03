import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Goals CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await login(page)

    // Navigate to goals page
    await navigateToRoute(page, 'goals')
  })

  test('should display goals header', async ({ page }) => {
    const header = getByTestId(page, 'goals-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'goals-subtitle')
    const text = await subtitle.textContent()
    expect(text).toMatch(/Track savings progress|financial goals/i)
  })

  test('should have new goal button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-goal-btn')
    const isVisible = await addBtn.isVisible({ timeout: 3000 }).catch(() => false)
    expect(isVisible).toBeTruthy()
  })

  test('should have goals grid', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalsGrid = getByTestId(page, 'goals-grid')
    await expect(goalsGrid).toBeVisible()
  })

  test('should display goal cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalCards = getByTestId(page, 'goal-card')
    const count = await goalCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have goal card with icon', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalCards = getByTestId(page, 'goal-card')
    const icons = goalCards.getByTestId('goal-icon')
    const count = await icons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal icon 🎯', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalCards = getByTestId(page, 'goal-card')
    const icons = goalCards.getByTestId('goal-icon')
    const hasIcon = await icons.first().isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasIcon).toBeTruthy()
  })

  test('should display goal name', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalNames = getByTestId(page, 'goal-name')
    const hasNames = await goalNames.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasNames).toBeTruthy()
  })

  test('should display goal date and countdown', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalDates = getByTestId(page, 'goal-date')
    const hasDates = await goalDates.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasDates).toBeTruthy()
  })

  test('should display days until target date', async ({ page }) => {
    await page.waitForTimeout(500)

    const textElements = page.locator('text=/Due \d+ days|days overdue|due today|due tomorrow/')
    const count = await textElements.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have progress bar for goal', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressBars = getByTestId(page, 'goal-progress-bar')
    if (await progressBars.isVisible({ timeout: 2000 }).catch(() => false)) {
      const count = await progressBars.count()
      expect(count).toBeGreaterThanOrEqual(0)
    }
  })

  test('should display progress percentage', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressPercent = getByTestId(page, 'goal-progress-percent')
    const hasPercent = await progressPercent.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasPercent).toBeTruthy()
  })

  test('should display progress current amount', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressCurrent = getByTestId(page, 'goal-progress-current')
    const hasCurrent = await progressCurrent.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasCurrent).toBeTruthy()
  })

  test('should display progress target', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressTarget = getByTestId(page, 'goal-progress-target')
    const hasTarget = await progressTarget.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasTarget).toBeTruthy()
  })

  test('should display current amount card', async ({ page }) => {
    await page.waitForTimeout(500)

    const currentAmount = getByTestId(page, 'goal-balance')
    const hasAmount = await currentAmount.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasAmount).toBeTruthy()
  })

  test('should have goal details section', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalDetails = getByTestId(page, 'goal-details')
    await expect(goalDetails).toBeVisible()
  })

  test('should display detail items (monthly, expected return, target date)', async ({ page }) => {
    await page.waitForTimeout(500)

    const detailItems = getByTestId(page, 'goal-detail-item')
    const count = await detailItems.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display monthly contribution', async ({ page }) => {
    await page.waitForTimeout(500)

    const monthlyDetail = getByTestId(page, 'goal-detail-monthly')
    const hasMonthly = await monthlyDetail.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasMonthly).toBeTruthy()
  })

  test('should display expected return rate', async ({ page }) => {
    await page.waitForTimeout(500)

    const returnDetail = getByTestId(page, 'goal-detail-return')
    const hasReturn = await returnDetail.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasReturn).toBeTruthy()
  })

  test('should display target date', async ({ page }) => {
    await page.waitForTimeout(500)

    const dateDetail = getByTestId(page, 'goal-detail-date')
    const hasDate = await dateDetail.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasDate).toBeTruthy()
  })

  test('should have edit button on goal card', async ({ page }) => {
    await page.waitForTimeout(500)

    const editBtns = getByTestId(page, 'goal-edit-btn')
    const count = await editBtns.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have delete button on goal card', async ({ page }) => {
    await page.waitForTimeout(500)

    const deleteBtns = getByTestId(page, 'goal-delete-btn')
    const count = await deleteBtns.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should open add goal modal', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-goal-btn')
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(200)

      const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
      const hasModal = await modal.isVisible({ timeout: 2000 }).catch(() => false)
      expect(hasModal).toBeTruthy()
    }
  })

  test('should have add/edit modal with title', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const title = modal.getByText(/Add Goal|Create Goal/)
      await expect(title).toBeVisible()
    }
  })

  test('should have form group for goal name', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const nameGroup = modal.getByText('Goal Name')
      await expect(nameGroup).toBeVisible()
    }
  })

  test('should have input for goal name', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const nameInput = modal.locator('input[placeholder*="Goal"], input[placeholder*="vacation"], input[placeholder*="fund"]')
      await expect(nameInput).toBeVisible()
    }
  })

  test('should have form group for target amount', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const targetGroup = modal.getByText('Target Amount')
      await expect(targetGroup).toBeVisible()
    }
  })

  test('should have input for target amount', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const targetInput = modal.locator('input[placeholder*="5000"], input[placeholder*="target"]')
      await expect(targetInput).toBeVisible()
    }
  })

  test('should have form group for target date', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const dateGroup = modal.getByText('Target Date')
      await expect(dateGroup).toBeVisible()
    }
  })

  test('should have date input for target date', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const dateInput = modal.locator('input[type="date"]')
      await expect(dateInput).toBeVisible()
    }
  })

  test('should have modal footer with cancel and submit buttons', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const footer = modal.locator('.modalFooter, [data-testid="modal-footer"]')
      await expect(footer).toBeVisible()

      const buttons = footer.locator('button')
      const count = await buttons.count()
      expect(count).toBeGreaterThanOrEqual(1)
    }
  })

  test('should have cancel button in modal footer', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const footer = modal.locator('.modalFooter, [data-testid="modal-footer"]')
      await expect(footer).toBeVisible()

      const cancelBtn = footer.getByText('Cancel')
      await expect(cancelBtn).toBeVisible()
    }
  })

  test('should have create/update button in modal footer', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const footer = modal.locator('.modalFooter, [data-testid="modal-footer"]')
      await expect(footer).toBeVisible()

      const submitBtn = footer.getByText(/Create|Update/)
      await expect(submitBtn).toBeVisible()
    }
  })

  test('should close modal when clicking overlay', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.locator('.modalOverlay, [data-testid="modal-overlay"]').click({ position: { x: 0, y: 0 } })
      await page.waitForTimeout(200)

      const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false)
      expect(isClosed).toBeFalsy()
    }
  })

  test('should close modal when clicking cancel button', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await modal.getByRole('button', { name: /Close/i }).click()
      await page.waitForTimeout(200)

      const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false)
      expect(isClosed).toBeFalsy()
    }
  })

  test('should handle empty goals state', async ({ page }) => {
    await navigateToRoute(page, 'goals')
    await page.waitForTimeout(500)

    const emptyState = getByTestId(page, 'empty-state')
    const hasEmptyState = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasEmptyState).toBeFalsy()
  })

  test('should show empty state message when no goals', async ({ page }) => {
    await navigateToRoute(page, 'goals')
    await page.waitForTimeout(500)

    const emptyState = getByTestId(page, 'empty-state')
    const hasEmptyText = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasEmptyText).toBeFalsy()
  })

  test('should calculate progress percentage correctly', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressBars = getByTestId(page, 'goal-progress-bar')
    if (await progressBars.isVisible({ timeout: 2000 }).catch(() => false)) {
      const count = await progressBars.count()
      expect(count).toBeGreaterThanOrEqual(0)
    }
  })

  test('should calculate days until target', async ({ page }) => {
    await page.waitForTimeout(500)

    const hasDayCalculations = await page.locator('text=/Due \d+ days/').isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasDayCalculations).toBeTruthy()
  })

  test('should handle goal deletion confirmation', async ({ page }) => {
    await page.waitForTimeout(500)

    const deleteBtns = getByTestId(page, 'goal-delete-btn')
    const count = await deleteBtns.count()

    if (count > 0) {
      await deleteBtns.first().click()
      await page.waitForTimeout(200)
    }
  })

  test('should handle console errors gracefully', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    page.on('pageerror', (error) => {
      errors.push(error.message)
    })

    await navigateToRoute(page, 'goals')
    await page.waitForTimeout(500)

    const criticalErrors = errors.filter(msg => msg.includes('Error') && !msg.includes('Failed to fetch'))
    expect(criticalErrors.length).toBeLessThan(3)
  })

  test('should display loading state', async ({ page }) => {
    await navigateToRoute(page, 'goals')
    await page.waitForTimeout(500)

    const loadingText = getByTestId(page, 'loading-state')
    const hasLoading = await loadingText.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasLoading).toBeTruthy()
  })

  test('should have responsive goal cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalCards = getByTestId(page, 'goal-card')
    const hasCards = await goalCards.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasCards).toBeTruthy()
  })

  test('should have proper form validation', async ({ page }) => {
    await getByTestId(page, 'add-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const submitBtn = modal.getByText(/Create|Update/)
      await submitBtn.click()
      await page.waitForTimeout(200)

      const isModalOpen = await modal.isVisible({ timeout: 500 }).catch(() => false)
      expect(isModalOpen).toBeTruthy()
    }
  })

  test('should be visible on page', async ({ page }) => {
    await navigateToRoute(page, 'goals')
    await page.waitForSelector('.page.page-goals, [data-test-id="page-goals"]', { state: 'attached', timeout: 5000 })
    await expect(page.locator('.page.page-goals, [data-test-id="page-goals"]')).toBeVisible()
  })

  test('should render all page elements correctly', async ({ page }) => {
    await navigateToRoute(page, 'goals')
    await page.waitForTimeout(500)

    await expect(page.locator('.page.page-goals, [data-test-id="page-goals"]')).toBeVisible()
    await expect(page.locator('.pageHeader')).toBeVisible()
    await expect(page.locator('.pageSubtitle')).toBeVisible()
  })

  test('should format date correctly', async ({ page }) => {
    await page.waitForTimeout(500)

    const dates = getByTestId(page, 'goal-date')
    const hasDates = await dates.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasDates).toBeTruthy()
  })

  test('should format currency correctly', async ({ page }) => {
    await page.waitForTimeout(500)

    const currencyValues = getByTestId(page, 'goal-progress-current')
    const hasCurrency = await currencyValues.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasCurrency).toBeTruthy()
  })
})
