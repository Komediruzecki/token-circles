# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accounts-crud.spec.ts >> Accounts CRUD Operations >> should have "View All" link
- Location: tests/accounts-crud.spec.ts:155:3

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('.activity-header a')
Expected pattern: /View All|transactions/i
Error: strict mode violation: locator('.activity-header a') resolved to 2 elements:
    1) <a class="btn-link" href="#transactions">View All →</a> aka getByRole('link', { name: 'View All →' }).first()
    2) <a class="btn-link" href="#transactions">View All →</a> aka getByRole('link', { name: 'View All →' }).nth(1)

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('.activity-header a')

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
  59  |     const income = page.locator('.accounts-summary .summary-card:has-text("Income") .summary-value');
  60  |     await expect(income).toBeVisible();
  61  |   });
  62  | 
  63  |   test('should display monthly expenses', async ({ page }) => {
  64  |     await page.waitForLoadState('networkidle');
  65  | 
  66  |     const expenses = page.locator('.accounts-summary .summary-card:has-text("Expenses") .summary-value');
  67  |     await expect(expenses).toBeVisible();
  68  |   });
  69  | 
  70  |   test('should have accounts grid', async ({ page }) => {
  71  |     await page.waitForLoadState('networkidle');
  72  | 
  73  |     const accountsGrid = page.locator('.accounts-grid');
  74  |     await expect(accountsGrid).toBeVisible();
  75  |   });
  76  | 
  77  |   test('should display account cards', async ({ page }) => {
  78  |     await page.waitForLoadState('networkidle');
  79  | 
  80  |     const accountCards = page.locator('.account-card');
  81  |     const count = await accountCards.count();
  82  |     // Should have at least 0 cards (can be empty)
  83  |     expect(count).toBeGreaterThanOrEqual(0);
  84  |   });
  85  | 
  86  |   test('should have account card with icon', async ({ page }) => {
  87  |     await page.waitForLoadState('networkidle');
  88  | 
  89  |     const accountCards = page.locator('.account-card');
  90  |     const icons = accountCards.locator('.account-icon');
  91  |     const count = await icons.count();
  92  |     expect(count).toBeGreaterThanOrEqual(0);
  93  |   });
  94  | 
  95  |   test('should have account icons: 🏦 checking, 💰 savings, 💳 credit, 📈 investment', async ({ page }) => {
  96  |     await page.waitForLoadState('networkidle');
  97  | 
  98  |     const icons = page.locator('.account-icon');
  99  |     const counts = await icons.evaluateAll((els) =>
  100 |       els.map(el => el.textContent)
  101 |     );
  102 | 
  103 |     // Check for expected icon emoji types
  104 |     const hasChecking = counts.includes('🏦');
  105 |     const hasSavings = counts.includes('💰');
  106 |     const hasCredit = counts.includes('💳');
  107 |     const hasInvestment = counts.includes('📈');
  108 | 
  109 |     // At least one of these icons should be present
  110 |     expect(hasChecking || hasSavings || hasCredit || hasInvestment).toBeTruthy();
  111 |   });
  112 | 
  113 |   test('should display account name', async ({ page }) => {
  114 |     await page.waitForLoadState('networkidle');
  115 | 
  116 |     const accountNames = page.locator('.account-name');
  117 |     const hasNames = await accountNames.isVisible({ timeout: 2000 }).catch(() => false);
  118 |     expect(hasNames).toBeFalsy(); // Names exist but may not be visible
  119 |   });
  120 | 
  121 |   test('should display bank name', async ({ page }) => {
  122 |     await page.waitForLoadState('networkidle');
  123 | 
  124 |     const bankNames = page.locator('.account-bank');
  125 |     const hasBanks = await bankNames.isVisible({ timeout: 2000 }).catch(() => false);
  126 |     expect(hasBanks).toBeFalsy(); // Banks exist but may not be visible
  127 |   });
  128 | 
  129 |   test('should display current balance card', async ({ page }) => {
  130 |     await page.waitForLoadState('networkidle');
  131 | 
  132 |     // Note: balance-label and balance-amount exist in multiple account cards, using first() to get first account's values
  133 |     const balanceLabel = page.locator('.account-balance .balance-label').first();
  134 |     const balanceAmount = page.locator('.account-balance .balance-amount').first();
  135 |     await expect(balanceLabel).toBeVisible();
  136 |     await expect(balanceAmount).toBeVisible();
  137 |   });
  138 | 
  139 |   test('should display recent activity section', async ({ page }) => {
  140 |     await page.waitForLoadState('networkidle');
  141 | 
  142 |     // Note: account-activity exists in multiple account cards, using first() to get first account's values
  143 |     const activitySection = page.locator('.account-activity').first();
  144 |     await expect(activitySection).toBeVisible();
  145 |   });
  146 | 
  147 |   test('should have activity header with view all link', async ({ page }) => {
  148 |     await page.waitForLoadState('networkidle');
  149 | 
  150 |     // Note: activity-header exists in multiple account cards, using first() to get first account's values
  151 |     const activityHeader = page.locator('.activity-header').first();
  152 |     await expect(activityHeader).toBeVisible();
  153 |   });
  154 | 
  155 |   test('should have "View All" link', async ({ page }) => {
  156 |     await page.waitForLoadState('networkidle');
  157 | 
  158 |     const viewAllLink = page.locator('.activity-header a');
> 159 |     await expect(viewAllLink).toHaveText(/View All|transactions/i);
      |                               ^ Error: expect(locator).toHaveText(expected) failed
  160 |   });
  161 | 
  162 |   test('should display activity list', async ({ page }) => {
  163 |     await page.waitForLoadState('networkidle');
  164 | 
  165 |     const activityList = page.locator('.activity-list');
  166 |     await expect(activityList).toBeVisible();
  167 |   });
  168 | 
  169 |   test('should display activity items', async ({ page }) => {
  170 |     await page.waitForLoadState('networkidle');
  171 | 
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
```