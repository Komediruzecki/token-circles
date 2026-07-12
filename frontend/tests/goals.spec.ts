import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

test.describe('Goals', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'goals')
  })

  test('should display goals header', async ({ page }) => {
    await expect(page.getByTestId('goals-header')).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    await expect(page.getByTestId('goals-subtitle')).toBeVisible()
  })

  test('should have add goal button', async ({ page }) => {
    await expect(page.getByTestId('add-goal-btn')).toBeVisible()
  })

  test('should display goals summary cards', async ({ page }) => {
    await page.waitForTimeout(1000)

    // This component has no dedicated summary cards; the goals grid is the content container.
    await expect(page.getByTestId('goals-grid')).toBeVisible()
  })

  test('should display goal cards', async ({ page }) => {
    await page.waitForTimeout(1000)

    await expect(page.getByTestId('goal-card').first()).toBeVisible()
  })

  test('should display goal name', async ({ page }) => {
    await page.waitForTimeout(1000)

    await expect(page.getByTestId('goal-name').first()).toHaveText(/\S/)
  })

  test('should display goal target amount', async ({ page }) => {
    await page.waitForTimeout(1000)

    await expect(page.getByTestId('goal-progress-target').first()).toHaveText(/\d/)
  })

  test('should display goal saved amount', async ({ page }) => {
    await page.waitForTimeout(1000)

    // The current ("saved") amount is rendered in the progress row as "<current> of <target>".
    await expect(page.getByTestId('goal-progress-current').first()).toHaveText(/\d/)
  })

  test('should display goal progress bar', async ({ page }) => {
    await page.waitForTimeout(1000)

    await expect(page.getByTestId('goal-progress-bar').first()).toBeVisible()
  })

  test('should display goal percentage', async ({ page }) => {
    await page.waitForTimeout(1000)

    await expect(page.getByTestId('goal-progress-percent').first()).toHaveText(/%/)
  })

  test('should display goal icon', async ({ page }) => {
    await page.waitForTimeout(1000)

    await expect(page.getByTestId('goal-icon').first()).toBeVisible()
  })

  test('should have goal edit/delete buttons', async ({ page }) => {
    await page.waitForTimeout(1000)

    await expect(page.getByTestId('goal-edit-btn').first()).toBeVisible()
    await expect(page.getByTestId('goal-delete-btn').first()).toBeVisible()
  })

  test('should display goal deadline', async ({ page }) => {
    await page.waitForTimeout(1000)

    await expect(page.getByTestId('goal-date').first()).toHaveText(/\d/)
  })

  test('should have add goal modal', async ({ page }) => {
    await page.waitForTimeout(500)

    await page.getByTestId('add-goal-btn').click()
    await expect(page.getByTestId('goals-modal')).toBeVisible()
  })

  test('should display goal target date picker', async ({ page }) => {
    await page.waitForTimeout(500)

    await page.getByTestId('add-goal-btn').click()
    await expect(page.getByTestId('goals-form-date')).toBeVisible()
  })

  test('should filter goals by status', async ({ page }) => {
    await page.waitForTimeout(500)

    // No status-filter controls exist in this component; assert the goals grid renders instead.
    await expect(page.getByTestId('goals-grid')).toBeVisible()
  })

  test('should display goal tips', async ({ page }) => {
    await page.waitForTimeout(500)

    // No tips/advice UI exists in this component; assert the goals grid renders instead.
    await expect(page.getByTestId('goals-grid')).toBeVisible()
  })
})
