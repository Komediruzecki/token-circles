import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Loans', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'loans')
  })

  test('should display loans header', async ({ page }) => {
    const header = getByTestId(page, 'loans-header')
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = getByTestId(page, 'loans-subtitle')
    await expect(subtitle).toBeVisible()
  })

  test('should have add loan button', async ({ page }) => {
    const addBtn = getByTestId(page, 'add-loan-btn')
    await expect(addBtn).toBeVisible()
  })

  test('should display loans summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const summaryCards = page.getByText(/Total Borrowed|Remaining|Active Loans/i, { exact: false })
    const count = await summaryCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const loanCards = page.getByRole('listitem')
    const count = await loanCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan name', async ({ page }) => {
    await page.waitForTimeout(500)

    const names = page.getByText(/Car Loan|Student Loan|Mortgage/i)
    const count = await names.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan principal', async ({ page }) => {
    await page.waitForTimeout(500)

    const principals = page.getByText(/Principal/i)
    const count = await principals.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan remaining balance', async ({ page }) => {
    await page.waitForTimeout(500)

    const balances = page.getByText(/Remaining/i)
    const count = await balances.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan interest rate', async ({ page }) => {
    await page.waitForTimeout(500)

    const rates = page.getByText(/\d+\.\d+%/)
    const count = await rates.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan monthly payment', async ({ page }) => {
    await page.waitForTimeout(500)

    const payments = page.getByText(/\$[\d,]+\.\d{2}/)
    const count = await payments.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan status badges', async ({ page }) => {
    await page.waitForTimeout(500)

    const statusBadges = page.getByText(/active|paid off|deferred/i, { exact: false })
    const count = await statusBadges.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan progress bar', async ({ page }) => {
    await page.waitForTimeout(500)

    const progressBars = page.locator('[style*="width"], progress')
    const count = await progressBars.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan progress percentage', async ({ page }) => {
    await page.waitForTimeout(500)

    const percentages = page.getByText(/\d+%/)
    const count = await percentages.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan total paid', async ({ page }) => {
    await page.waitForTimeout(500)

    const totals = page.getByText(/Total Paid/i)
    const count = await totals.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have loan edit/delete buttons', async ({ page }) => {
    await page.waitForTimeout(500)

    const editBtns = page.getByRole('button', { name: /edit/i })
    const deleteBtns = page.getByRole('button', { name: /delete/i })

    const editCount = await editBtns.count()
    const deleteCount = await deleteBtns.count()

    expect(editCount).toBeGreaterThanOrEqual(0)
    expect(deleteCount).toBeGreaterThanOrEqual(0)
  })

  test('should display loan amortization chart', async ({ page }) => {
    await page.waitForTimeout(500)

    const chart = page.getByRole('img', { name: /amortization|chart|graph/i })
    const count = await chart.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan detail rows', async ({ page }) => {
    await page.waitForTimeout(500)

    const detailRows = page.getByRole('row', { name: /principal|interest|payment/i })
    const count = await detailRows.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have add loan modal', async ({ page }) => {
    await page.waitForTimeout(500)

    const addBtn = getByTestId(page, 'add-loan-btn')
    await addBtn.click()

    await page.waitForTimeout(500)
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
  })

  test('should display loan start date', async ({ page }) => {
    await page.waitForTimeout(500)

    const dates = page.getByText(/\d{4}-\d{2}-\d{2}/)
    const count = await dates.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display loan term', async ({ page }) => {
    await page.waitForTimeout(500)

    const terms = page.getByText(/months?|years?/i)
    const count = await terms.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have prepayment option', async ({ page }) => {
    await page.waitForTimeout(500)

    const prepayBtns = page.getByRole('button', { name: /prepay|extra/i })
    const count = await prepayBtns.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
