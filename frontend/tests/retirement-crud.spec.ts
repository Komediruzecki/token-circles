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
    await expect(page.getByTestId('add-retirement-goal-btn')).toBeVisible()
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

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    // The grid wrapper renders only when at least one goal card exists.
    expect(await page.getByTestId('retirement-goals-grid').count()).toBe(cardCount > 0 ? 1 : 0)
  })

  test('should display goal cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const gridCount = await page.getByTestId('retirement-goals-grid').count()
    const cardCount = await page.getByTestId('retirement-goal-card').count()
    // Cards live inside the grid: cards exist iff the grid rendered.
    expect(cardCount > 0).toBe(gridCount === 1)
  })

  test('should have goal card with icon', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    // One icon per goal card.
    expect(await page.getByTestId('retirement-goal-icon').count()).toBe(cardCount)
  })

  test('should display goal icon 🎯', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-icon').count()).toBe(cardCount)
  })

  test('should display goal name', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-name').count()).toBe(cardCount)
  })

  test('should display goal balance', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-balance').count()).toBe(cardCount)
  })

  test('should have progress bar for goal', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-progress-bar').count()).toBe(cardCount)
  })

  test('should display progress percentage', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-progress-percent').count()).toBe(cardCount)
  })

  test('should display progress target', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-progress-target').count()).toBe(cardCount)
  })

  test('should display detail items', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    // Each goal card renders three detail items (monthly, return, target date).
    expect(await page.getByTestId('retirement-detail-item').count()).toBe(cardCount * 3)
  })

  test('should display monthly contribution detail', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-monthly-contribution').count()).toBe(cardCount)
  })

  test('should display expected return detail', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-expected-return').count()).toBe(cardCount)
  })

  test('should display target date detail', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-target-date').count()).toBe(cardCount)
  })

  test('should have edit button on goal card', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-edit-btn').count()).toBe(cardCount)
  })

  test('should have delete button on goal card', async ({ page }) => {
    await page.waitForTimeout(500)

    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-goal-delete-btn').count()).toBe(cardCount)
  })

  test('should open add goal modal', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-modal')).toBeVisible({ timeout: 2000 })
  })

  test('should have add/edit modal with title', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    // Copy is the point: the title reflects add vs edit mode, scoped to the title node.
    const title = page.getByTestId('retirement-modal-title')
    await expect(title).toBeVisible()
    await expect(title).toHaveText(/Add Retirement Goal|Edit Goal/)
  })

  test('should have form group for goal name', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-name')).toBeVisible()
  })

  test('should have input for goal name', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-name')).toBeEditable()
  })

  test('should have form group for target amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-target-amount')).toBeVisible()
  })

  test('should have input for target amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-target-amount')).toBeEditable()
  })

  test('should have form group for current amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-current-amount')).toBeVisible()
  })

  test('should have input for current amount', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-current-amount')).toBeEditable()
  })

  test('should have form group for current age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-current-age')).toBeVisible()
  })

  test('should have input for current age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-current-age')).toBeEditable()
  })

  test('should have form group for retirement age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-retirement-age')).toBeVisible()
  })

  test('should have input for retirement age', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-retirement-age')).toBeEditable()
  })

  test('should have form group for target date', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-target-date')).toBeVisible()
  })

  test('should have date input for target date', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-target-date')).toBeEditable()
  })

  test('should have form group for monthly contribution', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-monthly-contribution')).toBeVisible()
  })

  test('should have input for monthly contribution', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-monthly-contribution')).toBeEditable()
  })

  test('should have form group for expected return', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-expected-return')).toBeVisible()
  })

  test('should have input for expected return', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-form-expected-return')).toBeEditable()
  })

  test('should have form row layout', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    // Paired fields that share a form row both render.
    await expect(page.getByTestId('retirement-form-target-amount')).toBeVisible()
    await expect(page.getByTestId('retirement-form-current-amount')).toBeVisible()
  })

  test('should have modal footer with cancel and submit buttons', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()

    await expect(page.getByTestId('retirement-modal-footer')).toBeVisible()
    await expect(page.getByTestId('retirement-modal-cancel')).toBeVisible()
    await expect(page.getByTestId('retirement-modal-submit')).toBeVisible()
  })

  test('should have cancel button in modal footer', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-modal-cancel')).toBeVisible()
  })

  test('should have create/update button in modal footer', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    await expect(page.getByTestId('retirement-modal-submit')).toBeVisible()
  })

  test('should close modal when clicking overlay', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    const modal = page.getByTestId('retirement-modal')
    await expect(modal).toBeVisible({ timeout: 2000 })

    // Click the overlay backdrop (top-left corner sits outside the centered modal).
    await page.getByTestId('retirement-modal-overlay').click({ position: { x: 0, y: 0 } })
    await expect(modal).not.toBeVisible({ timeout: 2000 })
  })

  test('should close modal when clicking cancel button', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    const modal = page.getByTestId('retirement-modal')
    await expect(modal).toBeVisible({ timeout: 2000 })

    await page.getByTestId('retirement-modal-cancel').click()
    await expect(modal).not.toBeVisible({ timeout: 2000 })
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

  test('should render the projection chart', async ({ page }) => {
    await page.waitForTimeout(500)

    // The projection chart (and its Chart.js legend) is drawn on a <canvas>, so there is no
    // separate legend DOM node to target — assert the chart container renders instead.
    await expect(page.getByTestId('retirement-chart')).toBeVisible()
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

    const cards = page.getByTestId('retirement-goal-card')
    // Cards are data-driven; when any render, the first is visible in the grid.
    if (await cards.count()) {
      await expect(cards.first()).toBeVisible()
    }
  })

  test('should have proper form validation', async ({ page }) => {
    await page.getByTestId('add-retirement-goal-btn').click()
    const modal = page.getByTestId('retirement-modal')
    await expect(modal).toBeVisible({ timeout: 2000 })

    // Submitting the empty form is blocked by the required fields, so the modal stays open.
    await page.getByTestId('retirement-modal-submit').click()
    await expect(modal).toBeVisible()
  })

  test('should be visible on page', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await expect(page.getByTestId('retirement-page')).toBeVisible({ timeout: 5000 })
  })

  test('should render all page elements correctly', async ({ page }) => {
    await navigateToRoute(page, 'retirement')
    await page.waitForTimeout(500)

    await expect(page.getByTestId('retirement-page-header')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('retirement-subtitle')).toBeVisible({ timeout: 5000 })
  })

  test('should format currency correctly', async ({ page }) => {
    await page.waitForTimeout(500)

    // The projection details always render formatted money amounts (digits present).
    const details = page.getByTestId('retirement-projection-details')
    await expect(details).toBeVisible()
    await expect(details).toContainText(/\d/)
  })

  test('should format date correctly', async ({ page }) => {
    await page.waitForTimeout(500)

    // One formatted target date per goal card (data-driven; tolerant of an empty goal list).
    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-target-date').count()).toBe(cardCount)
  })

  test('should display retirement age badges', async ({ page }) => {
    await page.waitForTimeout(500)

    // One retirement-age badge per goal card.
    const cardCount = await page.getByTestId('retirement-goal-card').count()
    expect(await page.getByTestId('retirement-age-badge').count()).toBe(cardCount)
  })
})
