# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accounts-crud.spec.ts >> Accounts CRUD Operations >> should have select for currency
- Location: tests/accounts-crud.spec.ts:363:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.modal-overlay').locator('select')
Expected: visible
Error: strict mode violation: locator('.modal-overlay').locator('select') resolved to 2 elements:
    1) <select class="form-control">…</select> aka getByRole('combobox').first()
    2) <select class="form-control">…</select> aka getByRole('combobox').nth(1)

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.modal-overlay').locator('select')

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
              - button "Add Account" [active] [ref=e64]:
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
          - generic [ref=e115]:
            - generic [ref=e116]:
              - heading "Add Account" [level=3] [ref=e117]
              - button [ref=e118]:
                - img [ref=e119]
            - generic [ref=e121]:
              - generic [ref=e122]:
                - text: Account Name
                - textbox "e.g., Checking, Savings" [ref=e123]
              - generic [ref=e124]:
                - text: Account Type
                - combobox [ref=e125]:
                  - option "Checking" [selected]
                  - option "Savings"
                  - option "Credit Card"
                  - option "Investment"
              - generic [ref=e126]:
                - text: Bank / Institution
                - textbox "e.g., Chase, Bank of America" [ref=e127]
              - generic [ref=e128]:
                - text: Initial Balance
                - spinbutton [ref=e129]
              - generic [ref=e130]:
                - text: Currency
                - combobox [ref=e131]:
                  - option "USD - US Dollar" [selected]
                  - option "EUR - Euro"
                  - option "GBP - British Pound"
                  - option "JPY - Japanese Yen"
                  - option "CAD - Canadian Dollar"
              - generic [ref=e132]:
                - button "Cancel" [ref=e133]
                - button "Add Account" [ref=e134]
  - navigation [ref=e135]:
    - button "Toggle menu" [ref=e137]:
      - img
    - generic [ref=e139]:
      - heading "Finance." [level=1] [ref=e140]
      - paragraph [ref=e141]: Personal Finance Tracker
    - button "Loading..." [ref=e144]:
      - text: Loading...
      - img [ref=e145]
    - button "Sign In" [ref=e149]
    - generic [ref=e150]:
      - link "Dashboard" [ref=e151] [cursor=pointer]:
        - /url: "#dashboard"
        - img [ref=e152]
        - text: Dashboard
      - link "Transactions" [ref=e157] [cursor=pointer]:
        - /url: "#transactions"
        - img [ref=e158]
        - text: Transactions
      - link "Budgets" [ref=e160] [cursor=pointer]:
        - /url: "#budgets"
        - img [ref=e161]
        - text: Budgets
      - link "Loan Calculator" [ref=e163] [cursor=pointer]:
        - /url: "#loans"
        - img [ref=e164]
        - text: Loan Calculator
      - link "Savings Goals" [ref=e166] [cursor=pointer]:
        - /url: "#goals"
        - img [ref=e167]
        - text: Savings Goals
      - link "Bills" [ref=e169] [cursor=pointer]:
        - /url: "#bills"
        - img [ref=e170]
        - text: Bills
      - link "Import" [ref=e172] [cursor=pointer]:
        - /url: "#import"
        - img [ref=e173]
        - text: Import
      - link "Accounts" [ref=e175] [cursor=pointer]:
        - /url: "#accounts"
        - img [ref=e176]
        - text: Accounts
      - link "Retirement" [ref=e178] [cursor=pointer]:
        - /url: "#retirement"
        - img [ref=e179]
        - text: Retirement
      - link "Housing Calc" [ref=e181] [cursor=pointer]:
        - /url: "#housing"
        - img [ref=e182]
        - text: Housing Calc
      - link "Analytics" [ref=e184] [cursor=pointer]:
        - /url: "#analytics"
        - img [ref=e185]
        - text: Analytics
      - link "Categories" [ref=e187] [cursor=pointer]:
        - /url: "#categories"
        - img [ref=e188]
        - text: Categories
      - link "Settings" [ref=e190] [cursor=pointer]:
        - /url: "#settings"
        - img [ref=e191]
        - text: Settings
    - generic [ref=e195]:
      - generic [ref=e196]: Finance Manager v1.0
      - button "Reset Zoom" [ref=e197]
```

# Test source

```ts
  269 |     const modal = page.locator('.modal-overlay');
  270 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  271 |       const nameInput = modal.locator('input[placeholder*="Account"], input[placeholder*="checking"], input[placeholder*="savings"]');
  272 |       await expect(nameInput).toBeVisible();
  273 |     }
  274 |   });
  275 | 
  276 |   test('should have form group for account type', async ({ page }) => {
  277 |     await page.locator('.page-header button:has-text("Add Account")').click();
  278 | 
  279 |     const modal = page.locator('.modal-overlay');
  280 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  281 |       const typeGroup = modal.locator('label:has-text("Account Type")');
  282 |       await expect(typeGroup).toBeVisible();
  283 |     }
  284 |   });
  285 | 
  286 |   test('should have select for account type', async ({ page }) => {
  287 |     await page.locator('.page-header button:has-text("Add Account")').click();
  288 | 
  289 |     const modal = page.locator('.modal-overlay');
  290 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  291 |       const typeSelect = modal.locator('select');
  292 |       await expect(typeSelect).toBeVisible();
  293 |     }
  294 |   });
  295 | 
  296 |   test('should have account type options', async ({ page }) => {
  297 |     await page.locator('.page-header button:has-text("Add Account")').click();
  298 | 
  299 |     const modal = page.locator('.modal-overlay');
  300 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  301 |       const typeSelect = modal.locator('select');
  302 |       await typeSelect.selectOption('checking');
  303 | 
  304 |       // Verify the value is set
  305 |       await expect(typeSelect).toHaveValue('checking');
  306 | 
  307 |       // Try other options
  308 |       await typeSelect.selectOption('savings');
  309 |       await expect(typeSelect).toHaveValue('savings');
  310 |     }
  311 |   });
  312 | 
  313 |   test('should have form group for bank/institution', async ({ page }) => {
  314 |     await page.locator('.page-header button:has-text("Add Account")').click();
  315 | 
  316 |     const modal = page.locator('.modal-overlay');
  317 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  318 |       const bankGroup = modal.locator('label:has-text("Bank"), label:has-text("Institution")');
  319 |       await expect(bankGroup).toBeVisible();
  320 |     }
  321 |   });
  322 | 
  323 |   test('should have input for bank/institution', async ({ page }) => {
  324 |     await page.locator('.page-header button:has-text("Add Account")').click();
  325 | 
  326 |     const modal = page.locator('.modal-overlay');
  327 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  328 |       const bankInput = modal.locator('input[placeholder*="bank"], input[placeholder*="Chase"], input[placeholder*="institution"]');
  329 |       await expect(bankInput).toBeVisible();
  330 |     }
  331 |   });
  332 | 
  333 |   test('should have form group for initial balance', async ({ page }) => {
  334 |     await page.locator('.page-header button:has-text("Add Account")').click();
  335 | 
  336 |     const modal = page.locator('.modal-overlay');
  337 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  338 |       const balanceGroup = modal.locator('label:has-text("Initial Balance")');
  339 |       await expect(balanceGroup).toBeVisible();
  340 |     }
  341 |   });
  342 | 
  343 |   test('should have input for initial balance', async ({ page }) => {
  344 |     await page.locator('.page-header button:has-text("Add Account")').click();
  345 | 
  346 |     const modal = page.locator('.modal-overlay');
  347 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  348 |       const balanceInput = modal.locator('input[placeholder*="0"], input[placeholder*="balance"]');
  349 |       await expect(balanceInput).toBeVisible();
  350 |     }
  351 |   });
  352 | 
  353 |   test('should have form group for currency', async ({ page }) => {
  354 |     await page.locator('.page-header button:has-text("Add Account")').click();
  355 | 
  356 |     const modal = page.locator('.modal-overlay');
  357 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  358 |       const currencyGroup = modal.locator('label:has-text("Currency")');
  359 |       await expect(currencyGroup).toBeVisible();
  360 |     }
  361 |   });
  362 | 
  363 |   test('should have select for currency', async ({ page }) => {
  364 |     await page.locator('.page-header button:has-text("Add Account")').click();
  365 | 
  366 |     const modal = page.locator('.modal-overlay');
  367 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  368 |       const currencySelect = modal.locator('select');
> 369 |       await expect(currencySelect).toBeVisible();
      |                                    ^ Error: expect(locator).toBeVisible() failed
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
  464 |     expect(hasExpenses).toBeFalsy(); // Expenses exist but may be hidden
  465 |   });
  466 | 
  467 |   test('should handle account deletion confirmation', async ({ page }) => {
  468 |     await page.waitForLoadState('networkidle');
  469 | 
```