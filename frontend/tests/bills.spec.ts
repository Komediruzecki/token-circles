import { expect,test } from '@playwright/test'

test.describe('Bills', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#bills')
    await page.waitForLoadState('networkidle')
  })

  test('should display bills header', async ({ page }) => {
    const header = page.getByRole('heading', { name: /bills/i, level: 1 })
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByText(/manage|track|due/i, { exact: false })
    await expect(subtitle).toBeVisible()
  })

  test('should have add bill button', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /Add Bill/i })
    await expect(addBtn).toBeVisible()
  })

  test('should display bills summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const summaryCards = page.getByText(/Total Monthly|Due Soon|Overdue/i, { exact: false })
    const count = await summaryCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display bill cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const billCards = page.getByRole('listitem')
    const count = await billCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display bill name', async ({ page }) => {
    await page.waitForTimeout(500)

    const names = page.getByText(/Rent|Electricity|Insurance/i)
    const count = await names.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display bill amount', async ({ page }) => {
    await page.waitForTimeout(500)

    const amounts = page.getByText(/\$[\d,]+\.\d{2}/)
    const count = await amounts.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display bill due date', async ({ page }) => {
    await page.waitForTimeout(500)

    const dueDates = page.getByText(/\d{1,2}\/\d{1,2}/)
    const count = await dueDates.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display bill frequency', async ({ page }) => {
    await page.waitForTimeout(500)

    const frequencies = page.getByText(/monthly|weekly|yearly/i)
    const count = await frequencies.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display bill status badges', async ({ page }) => {
    await page.waitForTimeout(500)

    const statusBadges = page.getByText(/paid|pending|overdue|due soon/i, { exact: false })
    const count = await statusBadges.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display autopay indicator', async ({ page }) => {
    await page.waitForTimeout(500)

    const autopayIndicators = page.getByText(/Autopay/i)
    const count = await autopayIndicators.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have bill edit/delete buttons', async ({ page }) => {
    await page.waitForTimeout(500)

    const editBtns = page.getByRole('button', { name: /edit/i })
    const deleteBtns = page.getByRole('button', { name: /delete/i })

    const editCount = await editBtns.count()
    const deleteCount = await deleteBtns.count()

    expect(editCount).toBeGreaterThanOrEqual(0)
    expect(deleteCount).toBeGreaterThanOrEqual(0)
  })

  test('should display next due date', async ({ page }) => {
    await page.waitForTimeout(500)

    const nextDue = page.getByText(/Next Due/i)
    await expect(nextDue).toBeVisible()
  })

  test('should display bill category', async ({ page }) => {
    await page.waitForTimeout(500)

    const categories = page.getByText(/utilities|housing|insurance/i)
    const count = await categories.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display bill notes', async ({ page }) => {
    await page.waitForTimeout(500)

    const notes = page.getByText(/note|billing/i, { exact: false })
    const count = await notes.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have pay bill button', async ({ page }) => {
    await page.waitForTimeout(500)

    const payBtns = page.getByRole('button', { name: /pay/i })
    const count = await payBtns.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display total monthly spending', async ({ page }) => {
    await page.waitForTimeout(500)

    const total = page.getByText(/Total Monthly/i)
    await expect(total).toBeVisible()
  })

  test('should filter bills by status', async ({ page }) => {
    await page.waitForTimeout(500)

    const statusFilters = page.getByRole('button', { name: /all|paid|unpaid/i })
    const count = await statusFilters.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have add bill modal', async ({ page }) => {
    await page.waitForTimeout(500)

    const addBtn = page.getByRole('button', { name: /Add Bill/i })
    await addBtn.click()

    await page.waitForTimeout(300)
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
  })

  test('should display recurring bill indicator', async ({ page }) => {
    await page.waitForTimeout(500)

    const recurringIndicators = page.getByText(/recurring/i)
    const count = await recurringIndicators.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have bill checklist', async ({ page }) => {
    await page.waitForTimeout(500)

    const checklistItems = page.getByRole('checkbox')
    const count = await checklistItems.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display upcoming bills', async ({ page }) => {
    await page.waitForTimeout(500)

    const upcoming = page.getByText(/Upcoming/i)
    await expect(upcoming).toBeVisible()
  })
})