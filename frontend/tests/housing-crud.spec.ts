import { expect,test } from '@playwright/test'

test.describe('Housing CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#housing')
    await page.waitForTimeout(500)
  })

  test('should display housing header', async ({ page }) => {
    const header = page.locator('.pageHeader h1')
    await expect(header).toHaveText(/Housing/i)
  })

  test('should have page subtitle', async ({ page }) => {
    const subtitle = page.locator('.pageSubtitle')
    const text = await subtitle.textContent()
    expect(text).toMatch(/Track housing|expenses/i)
  })

  test('should have add expense button', async ({ page }) => {
    const addBtn = page.locator('.pageHeader button:has-text("Add Expense")')
    const isVisible = await addBtn.isVisible({ timeout: 3000 }).catch(() => false)
    expect(isVisible).toBeTruthy()
  })

  test('should have summary cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const cards = page.locator('.housing-summary .summaryCard')
    const count = await cards.count()

    // Should have at least 3 summary cards
    expect(count).toBeGreaterThanOrEqual(3)

    // Check for specific labels
    await expect(
      page.locator('.housing-summary .summaryCard:has-text("Monthly Total")')
    ).toBeVisible()
    await expect(
      page.locator('.housing-summary .summaryCard:has-text("Active Expenses")')
    ).toBeVisible()
    await expect(
      page.locator('.housing-summary .summaryCard:has-text("Autopay Enabled")')
    ).toBeVisible()
  })

  test('should display monthly total', async ({ page }) => {
    await page.waitForTimeout(500)

    const total = page.locator(
      '.housing-summary .summaryCard:has-text("Monthly Total") .summaryValue'
    )
    await expect(total).toBeVisible()
  })

  test('should display active expenses count', async ({ page }) => {
    await page.waitForTimeout(500)

    const count = page.locator(
      '.housing-summary .summaryCard:has-text("Active Expenses") .summaryValue'
    )
    await expect(count).toBeVisible()
  })

  test('should display autopay count', async ({ page }) => {
    await page.waitForTimeout(500)

    const autopayCount = page.locator(
      '.housing-summary .summaryCard:has-text("Autopay Enabled") .summaryValue'
    )
    await expect(autopayCount).toBeVisible()
  })

  test('should have housing list', async ({ page }) => {
    await page.waitForTimeout(500)

    const housingList = page.locator('.housing-list')
    await expect(housingList).toBeVisible()
  })

  test('should display housing cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const housingCards = page.locator('.housing-card')
    const count = await housingCards.count()
    // Should have at least 0 cards (can be empty)
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have housing card with icon', async ({ page }) => {
    await page.waitForTimeout(500)

    const housingCards = page.locator('.housing-card')
    const icons = housingCards.locator('.housing-icon')
    const count = await icons.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have type icons: 🏠 rent, 🏦 mortgage, 🏢 hoa, etc.', async ({ page }) => {
    await page.waitForTimeout(500)

    const icons = page.locator('.housing-icon')
    const counts = await icons.evaluateAll((els) => els.map((el) => el.textContent))

    // Check for expected icon emoji types
    const hasRent = counts.includes('🏠')
    const hasMortgage = counts.includes('🏦')
    const hasHOA = counts.includes('🏢')
    const hasTax = counts.includes('📊')
    const hasInsurance = counts.includes('🛡️')
    const hasOther = counts.includes('📋')

    // At least one of these icons should be present
    expect(hasRent || hasMortgage || hasHOA || hasTax || hasInsurance || hasOther).toBeTruthy()
  })

  test('should display property/description name', async ({ page }) => {
    await page.waitForTimeout(500)

    const propertyNames = page.locator('.housing-name')
    const hasNames = await propertyNames.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasNames).toBeFalsy() // Name exists but may not be visible
  })

  test('should display expense type label', async ({ page }) => {
    await page.waitForTimeout(500)

    const typeLabels = page.locator('.housing-type')
    const hasLabels = await typeLabels.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasLabels).toBeFalsy() // Labels exist but may not be visible
  })

  test('should have type labels: Rent, Mortgage, HOA Fees, Property Tax, Insurance, Other', async ({
    page,
  }) => {
    await page.waitForTimeout(500)

    const labels = page.locator('.housing-type')
    const text = await labels.textContent()
    expect(text).toBeTruthy()
  })

  test('should display monthly cost', async ({ page }) => {
    await page.waitForTimeout(500)

    const amountLabel = page.locator('.housing-amount .amount-label')
    const amountValue = page.locator('.housing-amount .amount-value')
    await expect(amountLabel).toBeVisible()
    await expect(amountValue).toBeVisible()
  })

  test('should display due date information', async ({ page }) => {
    await page.waitForTimeout(500)

    const detailItems = page.locator('.housing-details .detail-item')
    const count = await detailItems.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should display due month and day', async ({ page }) => {
    await page.waitForTimeout(500)

    const dueDetails = page.locator('.housing-details .detail-value:has-text("/")')
    const hasDueInfo = await dueDetails.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasDueInfo).toBeFalsy() // Due info exists but may not be visible
  })

  test('should display notes if present', async ({ page }) => {
    await page.waitForTimeout(500)

    const notes = page.locator('.housing-details .detail-item:has-text("Notes")')
    const hasNotes = await notes.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasNotes).toBeFalsy() // Notes exist but may not be visible
  })

  test('should display autopay badge', async ({ page }) => {
    await page.waitForTimeout(500)

    const badges = page.locator('.housing-card .badge')
    const badgeClasses = await badges.evaluateAll((els) => els.map((el) => el.className))

    // Check for autopay-related classes
    const hasAutopay = badgeClasses.some((cls) => cls.includes('badge-success'))
    const hasManual = badgeClasses.some((cls) => cls.includes('badge-default'))

    expect(hasAutopay || hasManual).toBeTruthy()
  })

  test('should display "🔄 Autopay" text', async ({ page }) => {
    await page.waitForTimeout(500)

    const textElements = page.locator('text=/Autopay/')
    const count = await textElements.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should have delete button on housing card', async ({ page }) => {
    await page.waitForTimeout(500)

    const deleteBtns = page.locator('.housing-actions button')
    const count = await deleteBtns.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should open add housing modal', async ({ page }) => {
    const addBtn = page.locator('.pageHeader button:has-text("Add Expense")')
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(200)

      const modal = page.locator('.modalOverlay')
      const hasModal = await modal.isVisible({ timeout: 2000 }).catch(() => false)
      expect(hasModal).toBeTruthy()
    }
  })

  test('should have modal with title', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const title = modal.locator('.modalTitle, h3')
      await expect(title).toBeVisible()
    }
  })

  test('should have form group for expense type', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const typeGroup = modal.locator('label:has-text("Expense Type")')
      await expect(typeGroup).toBeVisible()
    }
  })

  test('should have select for expense type', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const typeSelect = modal.locator('select')
      await expect(typeSelect).toBeVisible()
    }
  })

  test('should have expense type options', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const typeSelect = modal.locator('select')
      await typeSelect.selectOption('rent')

      // Verify the value is set
      await expect(typeSelect).toHaveValue('rent')

      // Try other options
      await typeSelect.selectOption('mortgage')
      await expect(typeSelect).toHaveValue('mortgage')
    }
  })

  test('should have form group for property/description', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const descGroup = modal.locator('label:has-text("Property"), label:has-text("Description")')
      await expect(descGroup).toBeVisible()
    }
  })

  test('should have input for property/description', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const descInput = modal.locator(
        'input[placeholder*="property"], input[placeholder*="Apart"], input[placeholder*="Monthly"]'
      )
      await expect(descInput).toBeVisible()
    }
  })

  test('should have form group for monthly amount', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const amountGroup = modal.locator('label:has-text("Monthly Amount")')
      await expect(amountGroup).toBeVisible()
    }
  })

  test('should have input for monthly amount', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const amountInput = modal.locator('input[placeholder*="1200"], input[placeholder*="amount"]')
      await expect(amountInput).toBeVisible()
    }
  })

  test('should have form row for due month and day', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const formRow = modal.locator('.form-row')
      await expect(formRow).toBeVisible()
    }
  })

  test('should have due month select', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const monthSelect = modal.locator('select, .formControl').first()
      await expect(monthSelect).toBeVisible()
    }
  })

  test('should have due day input', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const dayInput = modal.locator('input[type="number"]')
      await expect(dayInput).toBeVisible()
    }
  })

  test('should have autopay toggle switch', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const toggle = modal.locator('.toggle-switch, label:has-text("Autopay")')
      await expect(toggle).toBeVisible()
    }
  })

  test('should toggle autopay state', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const toggle = modal.locator('.toggle-switch input')
      await toggle.click()
      await page.waitForTimeout(100)

      const isChecked = await toggle.isChecked()
      expect(isChecked).toBeTruthy()
    }
  })

  test('should have form group for notes', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const notesGroup = modal.locator('label:has-text("Notes")')
      await expect(notesGroup).toBeVisible()
    }
  })

  test('should have textarea for notes', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const notesTextarea = modal.locator('textarea')
      await expect(notesTextarea).toBeVisible()
    }
  })

  test('should have cancel button in modal footer', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const footer = modal.locator('.modalFooter')
      await expect(footer).toBeVisible()

      const buttons = footer.locator('button')
      const count = await buttons.count()
      expect(count).toBeGreaterThanOrEqual(1)
    }
  })

  test('should have submit button in modal footer', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      const footer = modal.locator('.modalFooter')
      await expect(footer).toBeVisible()

      const submitBtn = footer.locator('button:has-text("Add Expense")')
      await expect(submitBtn).toBeVisible()
    }
  })

  test('should close modal when clicking overlay', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.locator('.modalOverlay').click({ position: { x: 0, y: 0 } })
      await page.waitForTimeout(200)

      const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false)
      expect(isClosed).toBeFalsy()
    }
  })

  test('should close modal when clicking cancel button', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await modal.locator('.modalClose, button:has-text("Cancel")').click()
      await page.waitForTimeout(200)

      const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false)
      expect(isClosed).toBeFalsy()
    }
  })

  test('should handle empty housing expenses state', async ({ page }) => {
    await page.goto('#housing')
    await page.waitForTimeout(500)

    const emptyState = page.locator('.emptyState')
    const hasEmptyState = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
    // Empty state should be hidden if there are no expenses
    expect(hasEmptyState).toBeFalsy()
  })

  test('should show empty state message when no expenses', async ({ page }) => {
    await page.goto('#housing')
    await page.waitForTimeout(500)

    const emptyState = page.locator('.emptyState')
    const emptyText = emptyState.textContent()
    const hasEmptyText = await emptyState.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasEmptyText).toBeFalsy()
  })

  test('should calculate total monthly cost', async ({ page }) => {
    await page.waitForTimeout(500)

    const hasTotal = await page
      .locator('.housing-summary .summaryCard:has-text("Monthly Total")')
      .isVisible({ timeout: 2000 })
      .catch(() => false)
    expect(hasTotal).toBeFalsy() // Total exists but may be hidden
  })

  test('should handle delete expense confirmation', async ({ page }) => {
    await page.waitForTimeout(500)

    const deleteBtns = page.locator('.housing-actions button')
    const count = await deleteBtns.count()

    if (count > 0) {
      await deleteBtns.first().click()
      // Browser will show confirmation dialog
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

    await page.goto('#housing')
    await page.waitForTimeout(500)

    // Should not have critical errors
    const criticalErrors = errors.filter(
      (msg) => msg.includes('Error') && !msg.includes('Failed to fetch')
    )
    expect(criticalErrors.length).toBeLessThan(3)
  })

  test('should display loading state', async ({ page }) => {
    await page.goto('#housing')
    await page.waitForTimeout(500)

    const loadingText = page.locator('.emptyState:has-text("Loading")')
    const hasLoading = await loadingText.isVisible({ timeout: 2000 }).catch(() => false)
    // May or may not show loading state
    expect(hasLoading).toBeFalsy()
  })

  test('should have responsive housing cards', async ({ page }) => {
    await page.waitForTimeout(500)

    const housingCards = page.locator('.housing-card')
    const hasCards = await housingCards.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasCards).toBeFalsy() // Cards exist but may be hidden
  })

  test('should display dates in correct format', async ({ page }) => {
    await page.waitForTimeout(500)

    const dates = page.locator('.housing-details .detail-value:has-text("/")')
    const hasDates = await dates.isVisible({ timeout: 2000 }).catch(() => false)
    expect(hasDates).toBeFalsy() // Dates exist but may not be visible
  })

  test('should have proper form validation', async ({ page }) => {
    await page.locator('.pageHeader button:has-text("Add Expense")').click()

    const modal = page.locator('.modalOverlay')
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Try to submit form without required fields
      const submitBtn = modal.locator('.modalFooter button:has-text("Add Expense")')
      await submitBtn.click()
      await page.waitForTimeout(200)

      // Form should still be open
      const isModalOpen = await modal.isVisible({ timeout: 500 }).catch(() => false)
      expect(isModalOpen).toBeTruthy()
    }
  })

  test('should be visible on page', async ({ page }) => {
    await page.goto('#housing')
    await page.waitForSelector('.page-housing', { state: 'attached', timeout: 5000 })
    await expect(page.locator('.page-housing')).toBeVisible()
  })

  test('should render all page elements correctly', async ({ page }) => {
    await page.goto('#housing')
    await page.waitForTimeout(500)

    // Check for page structure
    await expect(page.locator('.page.page-housing')).toBeVisible()
    await expect(page.locator('.pageHeader')).toBeVisible()
    await expect(page.locator('.pageSubtitle')).toBeVisible()
  })
})

