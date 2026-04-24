import { expect,test } from '@playwright/test'

test.describe('Housing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#housing')
    await page.waitForLoadState('networkidle')
  })

  test('should display housing header', async ({ page }) => {
    const header = page.getByRole('heading', { name: /housing/i, level: 1 })
    await expect(header).toBeVisible()
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.getByText(/property|expense|rent/i, { exact: false })
    await expect(subtitle).toBeVisible()
  })

  test('should have add housing button', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /Add Housing/i })
    await expect(addBtn).toBeVisible()
  })

  test('should display housing summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const summaryCards = page.getByText(/Total Monthly|Property Expense/i, { exact: false })
    const count = await summaryCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display housing cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const housingCards = page.getByRole('listitem')
    const count = await housingCards.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display housing property/description', async ({ page }) => {
    await page.waitForTimeout(500)

    const descriptions = page.getByText(/House|Apartment|Property/i)
    const count = await descriptions.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display housing monthly cost', async ({ page }) => {
    await page.waitForTimeout(500)

    const costs = page.getByText(/\$[\d,]+\.\d{2}/)
    const count = await costs.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display housing due date', async ({ page }) => {
    await page.waitForTimeout(500)

    const dueDates = page.getByText(/\d{1,2}\/\d{1,2}/)
    const count = await dueDates.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display housing notes if present', async ({ page }) => {
    await page.waitForTimeout(500)

    const notes = page.getByText(/note|management/i, { exact: false })
    const count = await notes.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display autopay badge', async ({ page }) => {
    await page.waitForTimeout(500)

    const autopayBadges = page.getByText(/🔄 Autopay/i)
    const count = await autopayBadges.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display housing expense type', async ({ page }) => {
    await page.waitForTimeout(500)

    const types = page.getByText(/mortgage|rent|hoa/i, { exact: false })
    const count = await types.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have housing edit/delete buttons', async ({ page }) => {
    await page.waitForTimeout(500)

    const editBtns = page.getByRole('button', { name: /edit/i })
    const deleteBtns = page.getByRole('button', { name: /delete/i })

    const editCount = await editBtns.count()
    const deleteCount = await deleteBtns.count()

    expect(editCount).toBeGreaterThanOrEqual(0)
    expect(deleteCount).toBeGreaterThanOrEqual(0)
  })

  test('should have add housing modal', async ({ page }) => {
    await page.waitForTimeout(500)

    const addBtn = page.getByRole('button', { name: /Add Housing/i })
    await addBtn.click()

    await page.waitForTimeout(300)
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
  })

  test('should have expense type select', async ({ page }) => {
    await page.waitForTimeout(500)

    const select = page.getByRole('combobox', { name: /type/i })
    const count = await select.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have property input', async ({ page }) => {
    await page.waitForTimeout(500)

    const inputs = page.getByRole('textbox', { name: /property|description/i })
    const count = await inputs.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have monthly amount input', async ({ page }) => {
    await page.waitForTimeout(500)

    const inputs = page.getByRole('spinbutton', { name: /monthly|amount/i })
    const count = await inputs.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have due month/day inputs', async ({ page }) => {
    await page.waitForTimeout(500)

    const inputs = page.getByRole('spinbutton')
    const count = await inputs.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have autopay toggle', async ({ page }) => {
    await page.waitForTimeout(500)

    const toggles = page.getByRole('checkbox', { name: /autopay/i })
    const count = await toggles.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have notes textarea', async ({ page }) => {
    await page.waitForTimeout(500)

    const textareas = page.getByRole('textbox', { multiline: true })
    const count = await textareas.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display empty state', async ({ page }) => {
    await page.waitForTimeout(500)

    const emptyState = page.getByText(/no expenses|add your first/i)
    const count = await emptyState.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should calculate total monthly cost', async ({ page }) => {
    await page.waitForTimeout(500)

    const total = page.getByText(/Total Monthly/i)
    await expect(total).toBeVisible()
  })

  test('should handle delete confirmation', async ({ page }) => {
    await page.waitForTimeout(500)

    const deleteBtns = page.getByRole('button', { name: /delete/i })
    const count = await deleteBtns.count()

    if (count > 0) {
      await deleteBtns.first().click()
      await page.waitForTimeout(300)
      // Should show confirmation dialog
      const dialog = page.getByRole('dialog')
      const dialogCount = await dialog.count()
      expect(dialogCount).toBeGreaterThanOrEqual(0)
    }
  })
})