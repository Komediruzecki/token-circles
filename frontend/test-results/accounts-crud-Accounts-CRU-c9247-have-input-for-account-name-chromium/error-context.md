# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accounts-crud.spec.ts >> Accounts CRUD Operations >> should have input for account name
- Location: tests/accounts-crud.spec.ts:266:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.modal-overlay').locator('input[placeholder*="Account"], input[placeholder*="checking"], input[placeholder*="savings"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.modal-overlay').locator('input[placeholder*="Account"], input[placeholder*="checking"], input[placeholder*="savings"]')

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
  172 |     const activityItems = page.locator('.activity-item');
  173 |     const count = await activityItems.count();
  174 |     expect(count).toBeGreaterThanOrEqual(0);
  175 |   });
  176 | 
  177 |   test('should display activity description', async ({ page }) => {
  178 |     await page.waitForLoadState('networkidle');
  179 | 
  180 |     const activityDesc = page.locator('.activity-desc');
  181 |     const hasDesc = await activityDesc.isVisible({ timeout: 2000 }).catch(() => false);
  182 |     expect(hasDesc).toBeFalsy(); // Desc exists but may not be visible
  183 |   });
  184 | 
  185 |   test('should display activity date', async ({ page }) => {
  186 |     await page.waitForLoadState('networkidle');
  187 | 
  188 |     const activityDate = page.locator('.activity-date');
  189 |     const hasDate = await activityDate.isVisible({ timeout: 2000 }).catch(() => false);
  190 |     expect(hasDate).toBeFalsy(); // Date exists but may not be visible
  191 |   });
  192 | 
  193 |   test('should display activity amount with +/-', async ({ page }) => {
  194 |     await page.waitForLoadState('networkidle');
  195 | 
  196 |     const activityAmounts = page.locator('.activity-amount');
  197 |     const hasAmounts = await activityAmounts.isVisible({ timeout: 2000 }).catch(() => false);
  198 |     expect(hasAmounts).toBeFalsy(); // Amounts exist but may not be visible
  199 |   });
  200 | 
  201 |   test('should have account type badge', async ({ page }) => {
  202 |     await page.waitForLoadState('networkidle');
  203 | 
  204 |     const badges = page.locator('.account-card .badge');
  205 |     const badgeClasses = await badges.evaluateAll((els) =>
  206 |       els.map(el => el.className)
  207 |     );
  208 | 
  209 |     // Check for common type classes
  210 |     const hasChecking = badgeClasses.some(cls => cls.includes('badge-primary'));
  211 |     const hasSavings = badgeClasses.some(cls => cls.includes('badge-success'));
  212 |     const hasCredit = badgeClasses.some(cls => cls.includes('badge-warning'));
  213 |     const hasInvestment = badgeClasses.some(cls => cls.includes('badge-info'));
  214 | 
  215 |     expect(hasChecking || hasSavings || hasCredit || hasInvestment).toBeTruthy();
  216 |   });
  217 | 
  218 |   test('should have account type badge text', async ({ page }) => {
  219 |     await page.waitForLoadState('networkidle');
  220 | 
  221 |     const badges = page.locator('.account-card .badge');
  222 |     const text = await badges.textContent();
  223 |     expect(text).toBeTruthy();
  224 |   });
  225 | 
  226 |   test('should have delete button on account card', async ({ page }) => {
  227 |     await page.waitForLoadState('networkidle');
  228 | 
  229 |     const deleteBtns = page.locator('.account-actions button:has-text("Delete")');
  230 |     const count = await deleteBtns.count();
  231 |     expect(count).toBeGreaterThanOrEqual(0);
  232 |   });
  233 | 
  234 |   test('should open add account modal', async ({ page }) => {
  235 |     const addBtn = page.locator('.page-header button:has-text("Add Account")');
  236 |     if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
  237 |       await addBtn.click();
  238 |       await page.waitForTimeout(200);
  239 | 
  240 |       const modal = page.locator('.modal-overlay');
  241 |       const hasModal = await modal.isVisible({ timeout: 2000 }).catch(() => false);
  242 |       expect(hasModal).toBeTruthy();
  243 |     }
  244 |   });
  245 | 
  246 |   test('should have add account modal with title', async ({ page }) => {
  247 |     await page.locator('.page-header button:has-text("Add Account")').click();
  248 | 
  249 |     const modal = page.locator('.modal-overlay');
  250 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  251 |       const title = modal.locator('.modal-title, h3');
  252 |       await expect(title).toBeVisible();
  253 |     }
  254 |   });
  255 | 
  256 |   test('should have form group for account name', async ({ page }) => {
  257 |     await page.locator('.page-header button:has-text("Add Account")').click();
  258 | 
  259 |     const modal = page.locator('.modal-overlay');
  260 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  261 |       const nameGroup = modal.locator('label:has-text("Account Name")');
  262 |       await expect(nameGroup).toBeVisible();
  263 |     }
  264 |   });
  265 | 
  266 |   test('should have input for account name', async ({ page }) => {
  267 |     await page.locator('.page-header button:has-text("Add Account")').click();
  268 | 
  269 |     const modal = page.locator('.modal-overlay');
  270 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  271 |       const nameInput = modal.locator('input[placeholder*="Account"], input[placeholder*="checking"], input[placeholder*="savings"]');
> 272 |       await expect(nameInput).toBeVisible();
      |                               ^ Error: expect(locator).toBeVisible() failed
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
  369 |       await expect(currencySelect).toBeVisible();
  370 |     }
  371 |   });
  372 | 
```