import { expect, test } from '@playwright/test'
import { login, navigateToRoute } from './test-helpers'

// Structural assertions target stable `data-test-id` hooks, never user-visible copy: a card
// renamed from "Recent Transactions" to "Transactions" must not break a smoke test. See
// tests/README.md for the test-id convention.
test.describe('Dashboard @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'dashboard')
    // The metrics grid renders once the dashboard data resolves; use it as the ready signal so
    // the per-test assertions below don't race the initial fetch (slow under parallel CI load).
    await expect(page.getByTestId('dashboard-metrics')).toBeVisible({ timeout: 15000 })
  })

  test('renders the page header and subtitle', async ({ page }) => {
    await expect(page.getByTestId('dashboard-header')).toBeVisible()
    await expect(page.getByTestId('dashboard-subtitle')).toBeVisible()
  })

  test('shows the net worth, income and expense metric cards', async ({ page }) => {
    await expect(page.getByTestId('dashboard-metric-networth')).toBeVisible()
    await expect(page.getByTestId('dashboard-metric-income')).toBeVisible()
    await expect(page.getByTestId('dashboard-metric-expenses')).toBeVisible()
  })

  test('shows a rendered net worth value', async ({ page }) => {
    const value = page.getByTestId('dashboard-metric-networth-value')
    await expect(value).toBeVisible()
    await expect(value).toHaveText(/\d/) // a formatted money amount, currency-agnostic
  })

  test('shows the charts region', async ({ page }) => {
    // The classic charts now live below a "Show more" toggle (the overview deck
    // is the default view), so expand it before asserting the region is shown.
    await page.getByRole('button', { name: /show more/i }).click()
    await expect(page.getByTestId('dashboard-charts')).toBeVisible()
  })

  test('shows the transactions strip with recent activity', async ({ page }) => {
    // The overview deck's Transactions panel (renamed from "Recent Transactions"). It renders when
    // the profile has recent activity, which the demo data provides — this is the assertion whose
    // raw-string predecessor silently broke when the card title changed.
    await expect(page.getByTestId('dashboard-transactions')).toBeVisible()
    await expect(page.getByTestId('dashboard-transaction-item').first()).toBeVisible()
  })

  test('exposes the header actions', async ({ page }) => {
    await expect(page.getByTestId('dashboard-refresh')).toBeVisible()
    await expect(page.getByTestId('dashboard-views')).toBeVisible()
  })

  test('gives Views drag handles only to the widgets under Show more', async ({ page }) => {
    // The rest have a fixed spot on the page, so a drag there would save an order that changes
    // nothing (core/dashboardWidgets.ts FIXED_SPOT_WIDGETS).
    await page.getByTestId('dashboard-views').click()
    const rows = page.locator('[data-test-id^="dashboard-views-row-"]')
    await expect(rows).toHaveCount(15)
    await expect(
      page.locator('[data-test-id^="dashboard-views-row-"][draggable="true"]')
    ).toHaveCount(6)
    await expect(page.getByTestId('dashboard-views-row-metrics')).not.toHaveAttribute(
      'draggable',
      'true'
    )
    await expect(page.getByTestId('dashboard-views-row-category-chart')).toHaveAttribute(
      'draggable',
      'true'
    )
  })

  test('has navigation links to the key pages', async ({ page }) => {
    // Attached rather than visible: the links always exist in the nav, but the sidebar may be
    // collapsed depending on viewport/state, which is orthogonal to "the routes are wired up".
    await expect(page.getByTestId('nav-link-accounts')).toBeAttached()
    await expect(page.getByTestId('nav-link-transactions')).toBeAttached()
    await expect(page.getByTestId('nav-link-budgets')).toBeAttached()
  })
})
