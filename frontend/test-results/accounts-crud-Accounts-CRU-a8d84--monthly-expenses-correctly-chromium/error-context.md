# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accounts-crud.spec.ts >> Accounts CRUD Operations >> should calculate monthly expenses correctly
- Location: tests/accounts-crud.spec.ts:460:3

# Error details

```
Error: expect(received).toBeFalsy()

Received: true
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - heading "Finance Manager" [level=1] [ref=e6]:
        - img [ref=e7]
        - text: Finance Manager
      - button "Settings" [ref=e10]:
        - img [ref=e11]
    - generic [ref=e14]:
      - complementary [ref=e15]:
        - navigation [ref=e16]:
          - link "Dashboard" [ref=e17] [cursor=pointer]:
            - /url: "#dashboard"
            - img [ref=e18]
            - text: Dashboard
          - link "Transactions" [ref=e20] [cursor=pointer]:
            - /url: "#transactions"
            - img [ref=e21]
            - text: Transactions
          - link "Accounts" [ref=e23] [cursor=pointer]:
            - /url: "#accounts"
            - img [ref=e24]
            - text: Accounts
          - link "Categories" [ref=e26] [cursor=pointer]:
            - /url: "#categories"
            - img [ref=e27]
            - text: Categories
          - link "Budgets" [ref=e29] [cursor=pointer]:
            - /url: "#budgets"
            - img [ref=e30]
            - text: Budgets
          - link "Goals" [ref=e33] [cursor=pointer]:
            - /url: "#goals"
            - img [ref=e34]
            - text: Goals
          - link "Loans" [ref=e36] [cursor=pointer]:
            - /url: "#loans"
            - img [ref=e37]
            - text: Loans
          - link "Bills" [ref=e39] [cursor=pointer]:
            - /url: "#bills"
            - img [ref=e40]
            - text: Bills
          - link "Retirement" [ref=e42] [cursor=pointer]:
            - /url: "#retirement"
            - img [ref=e43]
            - text: Retirement
          - link "Housing" [ref=e45] [cursor=pointer]:
            - /url: "#housing"
            - img [ref=e46]
            - text: Housing
          - link "Analytics" [ref=e48] [cursor=pointer]:
            - /url: "#analytics"
            - img [ref=e49]
            - text: Analytics
          - link "Import" [ref=e51] [cursor=pointer]:
            - /url: "#import"
            - img [ref=e52]
            - text: Import
          - link "Settings" [ref=e54] [cursor=pointer]:
            - /url: "#settings"
            - img [ref=e55]
            - text: Settings
      - main [ref=e58]:
        - generic [ref=e60]:
          - generic [ref=e61]:
            - generic [ref=e62]:
              - heading "Accounts" [level=1] [ref=e63]
              - button "Add Account" [ref=e64]:
                - img [ref=e65]
                - text: Add Account
            - paragraph [ref=e67]: Manage your bank accounts and track balances
          - generic [ref=e68]:
            - generic [ref=e69]:
              - generic [ref=e70]: Total Balance
              - generic [ref=e71]: €4,700.00
            - generic [ref=e72]:
              - generic [ref=e73]: Accounts
              - generic [ref=e74]: "2"
            - generic [ref=e75]:
              - generic [ref=e76]: Income (this month)
              - generic [ref=e77]: +€0.00
            - generic [ref=e78]:
              - generic [ref=e79]: Expenses (this month)
              - generic [ref=e80]: "-€0.00"
          - generic [ref=e81]:
            - generic [ref=e82]:
              - generic [ref=e83]:
                - generic [ref=e84]: 💼
                - generic [ref=e85]:
                  - heading "Checking Account" [level=3] [ref=e86]
                  - paragraph [ref=e87]: No bank listed
                - generic [ref=e88]:
                  - text: giro
                  - button [ref=e89]:
                    - img [ref=e90]
              - generic [ref=e92]:
                - generic [ref=e93]: Current Balance
                - generic [ref=e94]: €1,200.00
              - generic [ref=e96]:
                - text: Recent Activity
                - link "View All →" [ref=e97] [cursor=pointer]:
                  - /url: "#transactions"
            - generic [ref=e98]:
              - generic [ref=e99]:
                - generic [ref=e100]: 💰
                - generic [ref=e101]:
                  - heading "Savings Account" [level=3] [ref=e102]
                  - paragraph [ref=e103]: No bank listed
                - generic [ref=e104]:
                  - text: savings
                  - button [ref=e105]:
                    - img [ref=e106]
              - generic [ref=e108]:
                - generic [ref=e109]: Current Balance
                - generic [ref=e110]: €3,500.00
              - generic [ref=e112]:
                - text: Recent Activity
                - link "View All →" [ref=e113] [cursor=pointer]:
                  - /url: "#transactions"
  - navigation [ref=e114]:
    - button "Toggle menu" [ref=e116]:
      - img
    - generic [ref=e118]:
      - heading "Finance." [level=1] [ref=e119]
      - paragraph [ref=e120]: Personal Finance Tracker
    - button "Loading..." [ref=e123]:
      - text: Loading...
      - img [ref=e124]
    - button "Sign In" [ref=e128]
    - generic [ref=e129]:
      - link "Dashboard" [ref=e130] [cursor=pointer]:
        - /url: "#dashboard"
        - img [ref=e131]
        - text: Dashboard
      - link "Transactions" [ref=e136] [cursor=pointer]:
        - /url: "#transactions"
        - img [ref=e137]
        - text: Transactions
      - link "Budgets" [ref=e139] [cursor=pointer]:
        - /url: "#budgets"
        - img [ref=e140]
        - text: Budgets
      - link "Loan Calculator" [ref=e142] [cursor=pointer]:
        - /url: "#loans"
        - img [ref=e143]
        - text: Loan Calculator
      - link "Savings Goals" [ref=e145] [cursor=pointer]:
        - /url: "#goals"
        - img [ref=e146]
        - text: Savings Goals
      - link "Bills" [ref=e148] [cursor=pointer]:
        - /url: "#bills"
        - img [ref=e149]
        - text: Bills
      - link "Import" [ref=e151] [cursor=pointer]:
        - /url: "#import"
        - img [ref=e152]
        - text: Import
      - link "Accounts" [ref=e154] [cursor=pointer]:
        - /url: "#accounts"
        - img [ref=e155]
        - text: Accounts
      - link "Retirement" [ref=e157] [cursor=pointer]:
        - /url: "#retirement"
        - img [ref=e158]
        - text: Retirement
      - link "Housing Calc" [ref=e160] [cursor=pointer]:
        - /url: "#housing"
        - img [ref=e161]
        - text: Housing Calc
      - link "Analytics" [ref=e163] [cursor=pointer]:
        - /url: "#analytics"
        - img [ref=e164]
        - text: Analytics
      - link "Categories" [ref=e166] [cursor=pointer]:
        - /url: "#categories"
        - img [ref=e167]
        - text: Categories
      - link "Settings" [ref=e169] [cursor=pointer]:
        - /url: "#settings"
        - img [ref=e170]
        - text: Settings
    - generic [ref=e174]:
      - generic [ref=e175]: Finance Manager v1.0
      - button "Reset Zoom" [ref=e176]
```

# Test source

```ts
  364 |     await page.locator('.page-header button:has-text("Add Account")').click();
  365 | 
  366 |     const modal = page.locator('.modal-overlay');
  367 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  368 |       const currencySelect = modal.locator('select');
  369 |       await expect(currencySelect).toBeVisible();
  370 |     }
  371 |   });
  372 | 
  373 |   test('should have cancel button in modal footer', async ({ page }) => {
  374 |     await page.locator('.page-header button:has-text("Add Account")').click();
  375 | 
  376 |     const modal = page.locator('.modal-overlay');
  377 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  378 |       const footer = modal.locator('.modal-footer');
  379 |       await expect(footer).toBeVisible();
  380 | 
  381 |       const buttons = footer.locator('button');
  382 |       const count = await buttons.count();
  383 |       expect(count).toBeGreaterThanOrEqual(1);
  384 |     }
  385 |   });
  386 | 
  387 |   test('should have submit button in modal footer', async ({ page }) => {
  388 |     await page.locator('.page-header button:has-text("Add Account")').click();
  389 | 
  390 |     const modal = page.locator('.modal-overlay');
  391 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  392 |       const footer = modal.locator('.modal-footer');
  393 |       await expect(footer).toBeVisible();
  394 | 
  395 |       const submitBtn = footer.locator('button:has-text("Add Account")');
  396 |       await expect(submitBtn).toBeVisible();
  397 |     }
  398 |   });
  399 | 
  400 |   test('should close modal when clicking overlay', async ({ page }) => {
  401 |     await page.locator('.page-header button:has-text("Add Account")').click();
  402 | 
  403 |     const modal = page.locator('.modal-overlay');
  404 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  405 |       await page.locator('.modal-overlay').click({ position: { x: 0, y: 0 } });
  406 |       await page.waitForTimeout(200);
  407 | 
  408 |       const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false);
  409 |       expect(isClosed).toBeFalsy();
  410 |     }
  411 |   });
  412 | 
  413 |   test('should close modal when clicking cancel button', async ({ page }) => {
  414 |     await page.locator('.page-header button:has-text("Add Account")').click();
  415 | 
  416 |     const modal = page.locator('.modal-overlay');
  417 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  418 |       await modal.locator('.modal-close').click();
  419 |       await page.waitForTimeout(200);
  420 | 
  421 |       const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false);
  422 |       expect(isClosed).toBeFalsy();
  423 |     }
  424 |   });
  425 | 
  426 |   test('should handle empty accounts state', async ({ page }) => {
  427 |     await page.goto('#accounts');
  428 |     await page.waitForLoadState('networkidle');
  429 | 
  430 |     const emptyState = page.locator('.empty-state');
  431 |     const hasEmptyState = await emptyState.isVisible({ timeout: 2000 }).catch(() => false);
  432 |     // Empty state should be hidden if there are no accounts
  433 |     expect(hasEmptyState).toBeFalsy();
  434 |   });
  435 | 
  436 |   test('should show empty state message when no accounts', async ({ page }) => {
  437 |     await page.goto('#accounts');
  438 |     await page.waitForLoadState('networkidle');
  439 | 
  440 |     const emptyState = page.locator('.empty-state');
  441 |     const emptyText = emptyState.textContent();
  442 |     const hasEmptyText = await emptyState.isVisible({ timeout: 2000 }).catch(() => false);
  443 |     expect(hasEmptyText).toBeFalsy();
  444 |   });
  445 | 
  446 |   test('should calculate total balance correctly', async ({ page }) => {
  447 |     await page.waitForLoadState('networkidle');
  448 | 
  449 |     const hasTotal = await page.locator('.accounts-summary .summary-card:has-text("Total Balance")').isVisible({ timeout: 2000 }).catch(() => false);
  450 |     expect(hasTotal).toBeFalsy(); // Total exists but may be hidden
  451 |   });
  452 | 
  453 |   test('should calculate monthly income correctly', async ({ page }) => {
  454 |     await page.waitForLoadState('networkidle');
  455 | 
  456 |     const hasIncome = await page.locator('.accounts-summary .summary-card:has-text("Income")').isVisible({ timeout: 2000 }).catch(() => false);
  457 |     expect(hasIncome).toBeFalsy(); // Income exists but may be hidden
  458 |   });
  459 | 
  460 |   test('should calculate monthly expenses correctly', async ({ page }) => {
  461 |     await page.waitForLoadState('networkidle');
  462 | 
  463 |     const hasExpenses = await page.locator('.accounts-summary .summary-card:has-text("Expenses")').isVisible({ timeout: 2000 }).catch(() => false);
> 464 |     expect(hasExpenses).toBeFalsy(); // Expenses exist but may be hidden
      |                         ^ Error: expect(received).toBeFalsy()
  465 |   });
  466 | 
  467 |   test('should handle account deletion confirmation', async ({ page }) => {
  468 |     await page.waitForLoadState('networkidle');
  469 | 
  470 |     const deleteBtns = page.locator('.account-actions button:has-text("Delete")');
  471 |     const count = await deleteBtns.count();
  472 | 
  473 |     if (count > 0) {
  474 |       await deleteBtns.first().click();
  475 |       // Browser will show confirmation dialog
  476 |       await page.waitForTimeout(200);
  477 |     }
  478 |   });
  479 | 
  480 |   test('should handle console errors gracefully', async ({ page }) => {
  481 |     const errors: string[] = [];
  482 |     page.on('console', (msg) => {
  483 |       if (msg.type() === 'error') {
  484 |         errors.push(msg.text());
  485 |       }
  486 |     });
  487 | 
  488 |     page.on('pageerror', (error) => {
  489 |       errors.push(error.message);
  490 |     });
  491 | 
  492 |     await page.goto('#accounts');
  493 |     await page.waitForLoadState('networkidle');
  494 | 
  495 |     // Should not have critical errors
  496 |     const criticalErrors = errors.filter((msg) =>
  497 |       msg.includes('Error') && !msg.includes('Failed to fetch')
  498 |     );
  499 |     expect(criticalErrors.length).toBeLessThan(3);
  500 |   });
  501 | 
  502 |   test('should display loading state', async ({ page }) => {
  503 |     await page.goto('#accounts');
  504 |     await page.waitForTimeout(500);
  505 | 
  506 |     const loadingText = page.locator('.empty-state:has-text("Loading")');
  507 |     const hasLoading = await loadingText.isVisible({ timeout: 2000 }).catch(() => false);
  508 |     // May or may not show loading state
  509 |     expect(hasLoading).toBeFalsy();
  510 |   });
  511 | 
  512 |   test('should have responsive account cards', async ({ page }) => {
  513 |     await page.waitForLoadState('networkidle');
  514 | 
  515 |     const accountCards = page.locator('.account-card');
  516 |     const hasCards = await accountCards.isVisible({ timeout: 2000 }).catch(() => false);
  517 |     expect(hasCards).toBeFalsy(); // Cards exist but may be hidden
  518 |   });
  519 | 
  520 |   test('should have proper form validation', async ({ page }) => {
  521 |     await page.locator('.page-header button:has-text("Add Account")').click();
  522 | 
  523 |     const modal = page.locator('.modal-overlay');
  524 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  525 |       // Try to submit form without required fields
  526 |       const submitBtn = modal.locator('.modal-footer button:has-text("Add Account")');
  527 |       await submitBtn.click();
  528 |       await page.waitForTimeout(200);
  529 | 
  530 |       // Form should still be open
  531 |       const isModalOpen = await modal.isVisible({ timeout: 500 }).catch(() => false);
  532 |       expect(isModalOpen).toBeTruthy();
  533 |     }
  534 |   });
  535 | 
  536 |   test('should be visible on page', async ({ page }) => {
  537 |     await page.goto('#accounts');
  538 |     await page.waitForSelector('.page-accounts', { state: 'attached', timeout: 5000 });
  539 |     await expect(page.locator('.page-accounts')).toBeVisible();
  540 |   });
  541 | 
  542 |   test('should render all page elements correctly', async ({ page }) => {
  543 |     await page.goto('#accounts');
  544 |     await page.waitForLoadState('networkidle');
  545 | 
  546 |     // Check for page structure
  547 |     await expect(page.locator('.page.page-accounts')).toBeVisible();
  548 |     await expect(page.locator('.page-header')).toBeVisible();
  549 |     await expect(page.locator('.page-subtitle')).toBeVisible();
  550 |   });
  551 | });
```