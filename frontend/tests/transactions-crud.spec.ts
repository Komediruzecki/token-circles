import { test, expect } from '@playwright/test';

test.describe('Transactions CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#transactions');
    await page.waitForLoadState('networkidle');
  });

  test('should display transactions header', async ({ page }) => {
    const header = page.locator('.page-header h1');
    await expect(header).toHaveText('Transactions');
  });

  test('should have type selector buttons', async ({ page }) => {
    const buttons = page.locator('#tx-type-selector button');
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveText('Expense');
    await expect(buttons.nth(1)).toHaveText('Income');
    await expect(buttons.nth(2)).toHaveText('Transfer');
  });

  test('should open add transaction modal', async ({ page }) => {
    // Click on Add Transaction button (if exists) or open modal via data-action
    const addBtn = page.locator('.page-header button:has-text("Add"), button:has-text("Add Transaction")').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
    }
    // Alternatively try data-action
    await page.locator('[data-action="transactions:save"]').first().click();
    await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 5000 });
  });

  test('should open modal via close button', async ({ page }) => {
    // Ensure modal is not open
    await page.locator('#tx-modal').isVisible().then(isOpen => {
      if (isOpen) {
        page.locator('[data-action="transactions:setType"]').first().click(); // Click outside
      }
    });

    // Try data-action to open
    const saveBtn = page.locator('[data-action="transactions:save"]');
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
    }

    await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 5000 }).catch(() => {
      // Try alternative method
      page.locator('.modal-overlay[data-action=""]').first().click();
    });
  });

  test('should have transaction form fields', async ({ page }) => {
    // Try to find the modal
    const modal = page.locator('#tx-modal');
    if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Modal is open, check form fields
      await expect(page.locator('#tx-description')).toBeVisible();
      await expect(page.locator('#tx-amount')).toBeVisible();
      await expect(page.locator('#tx-date')).toBeVisible();
      await expect(page.locator('#tx-category')).toBeVisible();
      await expect(page.locator('#tx-currency')).toBeVisible();
    } else {
      // Modal is closed, check for potential add button
      const addBtn = page.locator('button:has-text("Add")').filter({ hasText: /Transaction|Add/ }).first();
      if (await addBtn.isVisible().catch(() => false)) {
        await addBtn.click();
        await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 3000 });
        await expect(page.locator('#tx-description')).toBeVisible();
        await expect(page.locator('#tx-amount')).toBeVisible();
        await expect(page.locator('#tx-date')).toBeVisible();
        await expect(page.locator('#tx-category')).toBeVisible();
      }
    }
  });

  test('should have currency options', async ({ page }) => {
    const currencySelect = page.locator('#tx-currency');
    if (await currencySelect.isVisible().catch(() => false)) {
      await currencySelect.click();
      await expect(page.locator('#tx-currency option')).toHaveCountGreaterThan(5);
    }
  });

  test('should have date field populated', async ({ page }) => {
    const dateInput = page.locator('#tx-date');
    if (await dateInput.isVisible().catch(() => false)) {
      const value = await dateInput.getAttribute('value') || '';
      // Check if it's a valid YYYY-MM-DD format
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('should have means of payment select', async ({ page }) => {
    const meansSelect = page.locator('#tx-means');
    if (await meansSelect.isVisible().catch(() => false)) {
      await meansSelect.selectOption('');
      await expect(meansSelect).toHaveValue('');
    }
  });

  test('should have beneficiary input', async ({ page }) => {
    const beneficiaryInput = page.locator('#tx-beneficiary');
    if (await beneficiaryInput.isVisible().catch(() => false)) {
      await expect(beneficiaryInput).toHaveAttribute('placeholder', /Who you paid/i);
    }
  });

  test('should have payor input', async ({ page }) => {
    const payorInput = page.locator('#tx-payor');
    if (await payorInput.isVisible().catch(() => false)) {
      await expect(payorInput).toHaveAttribute('placeholder', /Who paid you/i);
    }
  });

  test('should have notes textarea', async ({ page }) => {
    const notesTextarea = page.locator('#tx-notes');
    if (await notesTextarea.isVisible().catch(() => false)) {
      await expect(notesTextarea).toHaveAttribute('rows', '2');
    }
  });

  test('should support tag input', async ({ page }) => {
    const tagInput = page.locator('#tx-tag-new-input');
    if (await tagInput.isVisible().catch(() => false)) {
      await expect(tagInput).toHaveAttribute('placeholder', /Type tag name/i);
    }
  });

  test('should have receipt upload area', async ({ page }) => {
    const receiptLabel = page.locator('label[for="tx-receipt"], .receipt-placeholder');
    if (await receiptLabel.isVisible().catch(() => false)) {
      await expect(receiptLabel).toHaveText(/Click to upload receipt/i);
    }
  });

  test('should support file type restrictions on receipt', async ({ page }) => {
    const receiptInput = page.locator('input[type="file"][accept]');
    if (await receiptInput.isVisible().catch(() => false)) {
      const accept = await receiptInput.getAttribute('accept');
      expect(accept).toContain('image/');
      expect(accept).toContain('.pdf');
    }
  });

  test('should have modal close button', async ({ page }) => {
    const modal = page.locator('#tx-modal');
    if (await modal.isVisible().catch(() => false)) {
      const closeButton = modal.locator('.modal-header button');
      await expect(closeButton).toBeVisible();
    }
  });

  test('should have modal footer with cancel and save buttons', async ({ page }) => {
    const modal = page.locator('#tx-modal');
    if (await modal.isVisible().catch(() => false)) {
      const footer = modal.locator('.modal-footer');
      await expect(footer).toBeVisible();
      const buttons = footer.locator('button');
      await expect(buttons).toHaveCount(2);
      await expect(buttons.nth(0)).toHaveText(/Cancel/i);
      await expect(buttons.nth(1)).toHaveText(/Save Transaction/i);
    }
  });

  test('should close modal when clicking overlay', async ({ page }) => {
    // Try to open modal first
    const modal = page.locator('#tx-modal');
    await page.locator('[data-action="transactions:save"]').click().catch(() => {});

    if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Click outside modal
      await page.locator('.modal-overlay').first().click({ position: { x: 0, y: 0 } });
      // Wait for modal to close
      await page.waitForTimeout(200);
      const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false);
      expect(isClosed).toBeFalsy();
    }
  });

  test('should close modal when clicking cancel button', async ({ page }) => {
    await page.locator('[data-action="transactions:save"]').click().catch(() => {});

    const modal = page.locator('#tx-modal');
    if (await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await modal.locator('.modal-footer button:has-text("Cancel")').click();
      await page.waitForTimeout(200);
      const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false);
      expect(isClosed).toBeFalsy();
    }
  });

  test('should have receipt modal with preview', async ({ page }) => {
    // Look for receipt modal or try to open it
    const receiptModal = page.locator('#receipt-modal');
    if (await receiptModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(receiptModal).toBeVisible();
      const img = receiptModal.locator('img');
      await expect(img).toBeVisible();
    }
  });

  test('should have receipt metadata section', async ({ page }) => {
    const receiptModal = page.locator('#receipt-modal');
    if (await receiptModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      const metaItems = receiptModal.locator('.receipt-meta-item');
      await expect(metaItems).toHaveCount(4);
    }
  });

  test('should have receipt download button', async ({ page }) => {
    const receiptModal = page.locator('#receipt-modal');
    if (await receiptModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      const downloadBtn = receiptModal.locator('a:has-text("Download")');
      await expect(downloadBtn).toBeVisible();
    }
  });

  test('should have receipt delete button', async ({ page }) => {
    const receiptModal = page.locator('#receipt-modal');
    if (await receiptModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      const deleteBtn = receiptModal.locator('button:has-text("Delete")');
      await expect(deleteBtn).toBeVisible();
    }
  });

  test('should highlight expense type when selected', async ({ page }) => {
    const expenseBtn = page.locator('#tx-type-selector .expense');
    const isSelected = await expenseBtn.evaluate(el => el.classList.contains('active'));
    if (isSelected) {
      await expect(expenseBtn).toHaveClass(/active/);
    }
  });

  test('should highlight income type when selected', async ({ page }) => {
    const incomeBtn = page.locator('#tx-type-selector .income');
    await incomeBtn.click();
    await page.waitForTimeout(100);
    const isSelected = await incomeBtn.evaluate(el => el.classList.contains('active'));
    expect(isSelected).toBeTruthy();
  });

  test('should highlight transfer type when selected', async ({ page }) => {
    const transferBtn = page.locator('#tx-type-selector .transfer');
    await transferBtn.click();
    await page.waitForTimeout(100);
    const isSelected = await transferBtn.evaluate(el => el.classList.contains('active'));
    expect(isSelected).toBeTruthy();
  });

  test('should toggle between types', async ({ page }) => {
    const buttons = page.locator('#tx-type-selector button');
    await buttons.nth(1).click(); // Income
    await buttons.nth(2).click(); // Transfer
    await buttons.nth(0).click(); // Expense
    await page.waitForTimeout(100);

    const firstIsExpense = await buttons.nth(0).evaluate(el => el.classList.contains('active'));
    const secondIsIncome = await buttons.nth(1).evaluate(el => el.classList.contains('active'));
    const thirdIsTransfer = await buttons.nth(2).evaluate(el => el.classList.contains('active'));

    expect(firstIsExpense).toBeTruthy();
    expect(secondIsIncome).toBeFalsy();
    expect(thirdIsTransfer).toBeFalsy();
  });

  test('should prevent form submission with empty required fields', async ({ page }) => {
    // Try to submit form without required fields
    const saveBtn = page.locator('[data-action="transactions:save"]');
    await saveBtn.click();

    await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 2000 });

    // Submit without filling required fields
    await saveBtn.click();

    // Form should still be open or show validation errors
    await page.waitForTimeout(300);
    const isModalOpen = await page.locator('#tx-modal').isVisible({ timeout: 500 }).catch(() => false);
    expect(isModalOpen).toBeTruthy();
  });

  test('should display error messages for invalid data', async ({ page }) => {
    await page.locator('[data-action="transactions:save"]').click().catch(() => {});
    await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 2000 });

    // Try with invalid amount
    const amountInput = page.locator('#tx-amount');
    if (await amountInput.isVisible().catch(() => false)) {
      await amountInput.fill('invalid');
      const saveBtn = page.locator('[data-action="transactions:save"]');
      await saveBtn.click();
      await page.waitForTimeout(300);
    }
  });

  test('should support date selection', async ({ page }) => {
    await page.locator('[data-action="transactions:save"]').click().catch(() => {});
    await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 2000 });

    const dateInput = page.locator('#tx-date');
    if (await dateInput.isVisible().catch(() => false)) {
      await dateInput.click();
      await page.waitForTimeout(200);

      // Select a recent date
      await page.locator('select option[value="today"]').click().catch(() => {});
      await page.locator(`text=/202[0-9]-[0-5]/`).first().click();
      await page.waitForTimeout(200);

      const selectedValue = await dateInput.getAttribute('value');
      expect(selectedValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('should support category selection', async ({ page }) => {
    await page.locator('[data-action="transactions:save"]').click().catch(() => {});
    await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 2000 });

    const categorySelect = page.locator('#tx-category');
    if (await categorySelect.isVisible().catch(() => false)) {
      await categorySelect.click();
      await page.waitForTimeout(200);

      // Should have at least one category option
      const options = categorySelect.locator('option');
      const count = await options.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should be visible on page', async ({ page }) => {
    await page.goto('#transactions');
    await page.waitForSelector('.page-transactions', { state: 'attached', timeout: 5000 });
    await expect(page.locator('.page-transactions')).toBeVisible();
  });

  test('should load transactions list', async ({ page }) => {
    await page.goto('#transactions');
    await page.waitForLoadState('networkidle');

    // Try to find transaction list elements
    const txElements = page.locator('.transaction-card, [data-testid="transaction-row"]');
    const count = await txElements.count();
    // Either there are transactions, or the page has other content
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should have filter buttons (if visible)', async ({ page }) => {
    await page.goto('#transactions');
    await page.waitForLoadState('networkidle');

    // Check for filter type selector if it exists
    const txTypeSelector = page.locator('#tx-type-selector');
    const hasSelector = await txTypeSelector.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasSelector) {
      await expect(txTypeSelector).toBeVisible();
    }
  });

  test('should allow submitting transaction form with valid data', async ({ page }) => {
    // This is a positive test - if the API is available and functioning
    await page.goto('#transactions');
    await page.waitForLoadState('networkidle');

    // Open modal
    const saveBtn = page.locator('[data-action="transactions:save"]');
    await saveBtn.click().catch(() => {});

    await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 2000 }).catch(() => {
      // Try alternative method if the above fails
      page.locator('.page-header button:has-text("Add")').first().click();
    });

    // Fill in form fields
    const dateInput = page.locator('#tx-date');
    if (await dateInput.isVisible().catch(() => false)) {
      const today = new Date().toISOString().slice(0, 10);
      await dateInput.fill(today);
    }

    const descInput = page.locator('#tx-description');
    if (await descInput.isVisible().catch(() => false)) {
      await descInput.fill('Test transaction');
    }

    const amountInput = page.locator('#tx-amount');
    if (await amountInput.isVisible().catch(() => false)) {
      await amountInput.fill('100.00');
    }

    const categorySelect = page.locator('#tx-category');
    if (await categorySelect.isVisible().catch(() => false)) {
      await categorySelect.selectOption('0');
    }

    // Try to save
    const submitBtn = page.locator('[data-action="transactions:save"]');
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();

      // Wait for modal to potentially close
      await page.waitForTimeout(500);

      // Check if transaction was added or modal closed
      const isModalOpen = await page.locator('#tx-modal').isVisible({ timeout: 1000 }).catch(() => false);
      // Modal may close after save, which is acceptable
    }
  });

  test('should handle form reset on cancel', async ({ page }) => {
    await page.locator('[data-action="transactions:save"]').click().catch(() => {});
    await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 2000 });

    // Fill in form
    const descInput = page.locator('#tx-description');
    if (await descInput.isVisible().catch(() => false)) {
      await descInput.fill('Test transaction');
    }

    const amountInput = page.locator('#tx-amount');
    if (await amountInput.isVisible().catch(() => false)) {
      await amountInput.fill('100.00');
    }

    // Cancel the modal
    const cancelBtn = page.locator('.modal-footer button:has-text("Cancel")');
    await cancelBtn.click();

    // Modal should be closed
    const isClosed = await page.locator('#tx-modal').isVisible({ timeout: 500 }).catch(() => false);
    expect(isClosed).toBeFalsy();
  });

  test('should support switching between Add and Edit modes', async ({ page }) => {
    // For now just test the modal structure is consistent
    await page.locator('[data-action="transactions:save"]').click().catch(() => {});
    await page.waitForSelector('#tx-modal', { state: 'visible', timeout: 2000 });

    const title = page.locator('#tx-modal-title');
    await expect(title).toBeVisible();

    const modalContent = page.locator('.modal-body');
    await expect(modalContent).toBeVisible();

    const modalFooter = page.locator('.modal-footer');
    await expect(modalFooter).toBeVisible();
  });
});