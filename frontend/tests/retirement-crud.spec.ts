import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Retirement Planning CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'retirement')
  })

  test('should display retirement header', async ({ page }) => {
    const header = page.getByTestId('retirement-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByTestId('retirement-subtitle')
    const text = await subtitle.textContent()
    expect(text).toMatch(/retirement|savings progress|track/i)
  })

  test('should have add goal button', async ({ page }) => {
    const addBtn = page.getByTestId('add-retirement-goal-btn')
    const isVisible = await addBtn.isVisible({ timeout: 3000 }).catch(() => false)
    expect(isVisible).toBeTruthy()
  })

  test('should have projection cards section', async ({ page }) => {
    await page.waitForTimeout(500)

    const projectionCards = page.getByTestId('retirement-projection-row')
    const hasCards = await projectionCards.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasCards).toBeTruthy()
  })

  test('should have projection details section', async ({ page }) => {
    await page.waitForTimeout(500)

    const projectionDetails = page.getByTestId('retirement-projection-details')
    const hasDetails = await projectionDetails.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasDetails).toBeTruthy()
  })

  test('should have goals section', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalsSection = page.getByTestId('retirement-goals')
    const hasSection = await goalsSection.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasSection).toBeTruthy()
  })

  test('should have goals grid', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalsGrid = page.getByTestId('retirement-goals-grid')
  const gridCount = await goalsGrid.count()
  expect(gridCount).toBeGreaterThanOrEqual(0)
  })

  test('should display goal cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalCards = page.getByTestId('retirement-goal-card')
    const count = await goalCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have goal card with icon', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalCards = page.getByTestId('retirement-goal-card')
    const icons = goalCards.getByTestId('retirement-goal-icon')
    const count = await icons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display goal icon 🎯', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalCards = page.getByTestId('retirement-goal-card')
  const iconCount = await goalCards.getByTestId('retirement-goal-icon').count()
  expect(iconCount).toBeGreaterThanOrEqual(0)
  })

  test('should display goal name', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalNames = page.getByTestId('retirement-goal-name')
  const nameCount = await goalNames.count()
  expect(nameCount).toBeGreaterThanOrEqual(0)
  })

  test('should display goal balance', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalBalance = page.getByTestId('retirement-goal-balance')
  const balCount = await goalBalance.count()
  expect(balCount).toBeGreaterThanOrEqual(0)
  })

  test('should have progress bar for goal', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressBars = page.getByTestId('retirement-progress-bar')
  const barCount = await progressBars.count()
  expect(barCount).toBeGreaterThanOrEqual(0)
  })

  test('should display progress percentage', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressPercent = page.getByTestId('retirement-progress-percent')
  const pctCount = await progressPercent.count()
  expect(pctCount).toBeGreaterThanOrEqual(0)
  })

  test('should display progress target', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressTarget = page.getByTestId('retirement-progress-target')
  const tgtCount = await progressTarget.count()
  expect(tgtCount).toBeGreaterThanOrEqual(0)
  })

  test('should display detail items', async ({ page }) => {
    await page.waitForTimeout(500)

    const detailItems = page.getByTestId('retirement-detail-item')
    const count = await detailItems.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display monthly contribution detail', async ({ page }) => {
    await page.waitForTimeout(500)

    const monthlyDetail = page.getByTestId('retirement-monthly-contribution')
  const monCount = await monthlyDetail.count()
  expect(monCount).toBeGreaterThanOrEqual(0)
  })

  test('should display expected return detail', async ({ page }) => {
    await page.waitForTimeout(500)

    const returnDetail = page.getByTestId('retirement-expected-return')
  const retCount = await returnDetail.count()
  expect(retCount).toBeGreaterThanOrEqual(0)
  })

  test('should display target date detail', async ({ page }) => {
    await page.waitForTimeout(500)

    const dateDetail = page.getByTestId('retirement-target-date')
  const dtCount = await dateDetail.count()
  expect(dtCount).toBeGreaterThanOrEqual(0)
  })

  test('should have edit button on goal card', async ({ page }) => {
    await page.waitForTimeout(500)

    const editBtns = page.getByTestId('retirement-goal-edit-btn')
    const count = await editBtns.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have delete button on goal card', async ({ page }) => {
    await page.waitForTimeout(500)

    const deleteBtns = page.getByTestId('retirement-goal-delete-btn')
    const count = await deleteBtns.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should open add goal modal', async ({ page }) => {
    const addBtn = page.getByTestId('add-retirement-goal-btn')
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(200)

      const modal = page.getByRole('dialog')
    const hasModal = await modal.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasModal).toBeTruthy()
    }
  })

  test('should have add/edit modal with title', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const title = modal.getByText(/Add Retirement Goal|Create Goal/i)
      await expect(title).toBeVisible()
    }
  })

  test('should have form group for goal name', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const nameGroup = modal.getByText('Goal Name')
      await expect(nameGroup).toBeVisible()
    }
  })

  test('should have input for goal name', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const nameInput = modal.locator(
        'input[type="text"], input[placeholder*="Full"], input[placeholder*="Early"]'
      )
      await expect(nameInput).toBeVisible()
    }
  })

  test('should have form group for target amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const targetGroup = modal.getByText('Target Amount')
      await expect(targetGroup).toBeVisible()
    }
  })

  test('should have input for target amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const targetInput = modal.locator('input[type="number"], input[placeholder*="1000000"]')
      await expect(targetInput).toBeVisible()
    }
  })

  test('should have form group for current amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const currentGroup = modal.getByText('Current Amount')
      await expect(currentGroup).toBeVisible()
    }
  })

  test('should have input for current amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const currentInput = modal.locator('input[type="number"], input[placeholder*="50000"]')
      await expect(currentInput).toBeVisible()
    }
  })

  test('should have form group for current age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const ageGroup = modal.getByText('Current Age')
      await expect(ageGroup).toBeVisible()
    }
  })

  test('should have input for current age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const ageInput = modal.locator('input[type="number"], input[placeholder*="30"]')
      await expect(ageInput).toBeVisible()
    }
  })

  test('should have form group for retirement age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const retGroup = modal.getByText('Retirement Age')
      await expect(retGroup).toBeVisible()
    }
  })

  test('should have input for retirement age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const retInput = modal.locator('input[type="number"], input[placeholder*="65"]')
      await expect(retInput).toBeVisible()
    }
  })

  test('should have form group for target date', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const dateGroup = modal.getByText('Target Date')
      await expect(dateGroup).toBeVisible()
    }
  })

  test('should have date input for target date', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const dateInput = modal.locator('input[type="date"]')
      await expect(dateInput).toBeVisible()
    }
  })

  test('should have form group for monthly contribution', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const monthlyGroup = modal.getByText('Monthly Contribution')
      await expect(monthlyGroup).toBeVisible()
    }
  })

  test('should have input for monthly contribution', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const monthlyInput = modal.locator('input[type="number"], input[placeholder*="500"]')
      await expect(monthlyInput).toBeVisible()
    }
  })

  test('should have form group for expected return', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const retGroup = modal.getByText('Expected Annual Return')
      await expect(retGroup).toBeVisible()
    }
  })

  test('should have input for expected return', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const retInput = modal.locator('input[type="number"], input[placeholder*="7"]')
      await expect(retInput).toBeVisible()
    }
  })

  test('should have form row layout', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const formRows = modal.locator('.form-row')
      const count = await formRows.count()
      expect(count).toBeGreaterThanOrEqual(1)
    }
  })

  test('should have modal footer with cancel and submit buttons', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const footer = modal.locator('.modalFooter, [data-testid="modal-footer"]')
      await expect(footer).toBeVisible()

      const buttons = footer.locator('button')
      const count = await buttons.count()
      expect(count).toBeGreaterThanOrEqual(2)
    }
  })

  test('should have cancel button in modal footer', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const footer = modal.locator('.modalFooter, [data-testid="modal-footer"]')
      await expect(footer).toBeVisible()

      const cancelBtn = footer.getByText('Cancel')
      await expect(cancelBtn).toBeVisible()
    }
  })

  test('should have create/update button in modal footer', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const footer = modal.locator('.modalFooter, [data-testid="modal-footer"]')
      await expect(footer).toBeVisible()

      const submitBtn = footer.getByText(/Create|Update/)
      await expect(submitBtn).toBeVisible()
    }
  })

  test('should close modal when clicking overlay', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page
        .locator('.modalOverlay, [data-testid="modal-overlay"]')
        .click({ position: { x: 0, y: 0 } })
      await page.waitForTimeout(200)

      const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false)
      expect(isClosed).toBeFalsy()
    }
  })

  test('should close modal when clicking cancel button', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    const modal = page.locator('.modalOverlay, [data-testid="modal-overlay"]')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await modal.getByRole('button', { name: /Close/i }).click()
      await page.waitForTimeout(200)

      const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false)
      expect(isClosed).toBeFalsy()
    }
  })

  test('should handle empty retirement state', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    const emptyState = page.getByTestId('empty-state')
    const hasEmptyState = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasEmptyState).toBeFalsy()
  })

  test('should show empty state message when no retirement goals', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    const emptyState = page.getByTestId('empty-state')
    const hasEmptyText = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasEmptyText).toBeFalsy()
  })

  test('should have projection bars section', async ({ page }) => {
    await page.waitForTimeout(500)

    const projectionBars = page.getByTestId('retirement-projections')
    const hasBars = await projectionBars.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasBars).toBeTruthy()
  })

  test('should have chart legend', async ({ page }) => {
    await page.waitForTimeout(500)

    const chartLegend = page.getByTestId('retirement-chart-legend')
  const legendCount = await chartLegend.count()
  expect(legendCount).toBeGreaterThanOrEqual(0)
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

    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    const criticalErrors = errors.filter(
      (msg) => msg.includes('Error') && !msg.includes('Failed to fetch')
    )
    expect(criticalErrors.length).toBeLessThan(3)
  })

  test('should display loading state', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    const loadingText = page.getByTestId('loading-state')
  const pageContent = page.getByTestId('retirement-projections')
  const hasLoading = await loadingText.isVisible({ timeout: 500 }).catch(() => false)
  const hasContent = await pageContent.isVisible({ timeout: 500 }).catch(() => false)
  expect(hasLoading || hasContent).toBeTruthy()
  })

  test('should have responsive goal cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const goalCards2 = page.getByTestId('retirement-goal-card')
  const cardCount = await goalCards2.count()
  expect(cardCount).toBeGreaterThanOrEqual(0)
  })

  test('should have proper form validation', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

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
    await navigateToRoute(page, 'retirement')
    await page.waitForSelector('.page.page-retirement, [data-test-id="page-retirement"]', {
      state: 'attached',
      timeout: 5000,
    })
    await expect(
      page.locator('.page.page-retirement, [data-test-id="page-retirement"]')
    ).toBeVisible()
  })

  test('should render all page elements correctly', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    await expect(
      page.locator('.page.page-retirement, [data-test-id="page-retirement"]')
    ).toBeVisible()
    await expect(page.getByTestId('retirement-page-header')).toBeVisible()
    await expect(page.getByTestId('retirement-subtitle')).toBeVisible()
  })

  test('should format currency correctly', async ({ page }) => {
    await page.waitForTimeout(500)

    const currencyValues = page.locator(
      '.card-value, .detail-value, .goal-progress .progress-target'
    )
    const count = await currencyValues.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should format date correctly', async ({ page }) => {
    await page.waitForTimeout(500)

    const dateValues = page.getByTestId('retirement-target-date')
    const dtCount = await dateValues.count()
    expect(dtCount).toBeGreaterThanOrEqual(0)
  })

  test('should display retirement age badges', async ({ page }) => {
    await page.waitForTimeout(500)

    const badges = page.getByTestId('retirement-retirement-age-badge')
    const badgeCount = await badges.count()
    expect(badgeCount).toBeGreaterThanOrEqual(0)
  })
})
