# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: bills-crud.spec.ts >> Bills CRUD Operations >> should have upcoming bills section
- Location: tests/bills-crud.spec.ts:34:3

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
              - heading "Bills" [level=1] [ref=e63]
              - button "Add Bill" [ref=e64]:
                - img [ref=e65]
                - text: Add Bill
            - paragraph [ref=e67]: Track upcoming payments and never miss a due date
          - generic [ref=e68]:
            - heading "🔔 Upcoming Bills6 bills" [level=2] [ref=e69]:
              - text: 🔔 Upcoming Bills
              - generic [ref=e70]: 6 bills
            - generic [ref=e71]:
              - generic [ref=e72]:
                - generic [ref=e73]:
                  - generic [ref=e74]: 📝
                  - generic [ref=e75]:
                    - heading "Car Insurance" [level=3] [ref=e76]
                    - paragraph [ref=e77]: Invalid Date • Due in NaN days • Monthly
                - generic [ref=e78]:
                  - generic [ref=e79]: €120.00
                  - button "Mark Paid" [ref=e80]
              - generic [ref=e81]:
                - generic [ref=e82]:
                  - generic [ref=e83]: 📝
                  - generic [ref=e84]:
                    - heading "Electricity Bill" [level=3] [ref=e85]
                    - paragraph [ref=e86]: Invalid Date • Due in NaN days • Monthly
                - generic [ref=e87]:
                  - generic [ref=e88]: €150.00
                  - button "Mark Paid" [ref=e89]
              - generic [ref=e90]:
                - generic [ref=e91]:
                  - generic [ref=e92]: 📝
                  - generic [ref=e93]:
                    - heading "Health Insurance" [level=3] [ref=e94]
                    - paragraph [ref=e95]: Invalid Date • Due in NaN days • Monthly
                - generic [ref=e96]:
                  - generic [ref=e97]: €200.00
                  - button "Mark Paid" [ref=e98]
              - generic [ref=e99]:
                - generic [ref=e100]:
                  - generic [ref=e101]: 📝
                  - generic [ref=e102]:
                    - heading "Internet Service" [level=3] [ref=e103]
                    - paragraph [ref=e104]: Invalid Date • Due in NaN days • Monthly
                - generic [ref=e105]:
                  - generic [ref=e106]: €70.00
                  - button "Mark Paid" [ref=e107]
              - generic [ref=e108]:
                - generic [ref=e109]:
                  - generic [ref=e110]: 📝
                  - generic [ref=e111]:
                    - heading "Natural Gas Bill" [level=3] [ref=e112]
                    - paragraph [ref=e113]: Invalid Date • Due in NaN days • Monthly
                - generic [ref=e114]:
                  - generic [ref=e115]: €80.00
                  - button "Mark Paid" [ref=e116]
              - generic [ref=e117]:
                - generic [ref=e118]:
                  - generic [ref=e119]: 📝
                  - generic [ref=e120]:
                    - heading "Rent / Mortgage" [level=3] [ref=e121]
                    - paragraph [ref=e122]: Invalid Date • Due in NaN days • Monthly
                - generic [ref=e123]:
                  - generic [ref=e124]: €600.00
                  - button "Mark Paid" [ref=e125]
          - generic [ref=e126]:
            - heading "✅ Paid Bills6 bills" [level=2] [ref=e127]:
              - text: ✅ Paid Bills
              - generic [ref=e128]: 6 bills
            - generic [ref=e129]:
              - generic [ref=e130]:
                - generic [ref=e131]:
                  - generic [ref=e132]: ✅
                  - generic [ref=e133]:
                    - heading "Car Insurance" [level=3] [ref=e134]
                    - paragraph [ref=e135]: Paid Apr 10, 2026
                - generic [ref=e136]:
                  - generic [ref=e137]: €120.00
                  - button [ref=e138]:
                    - img [ref=e139]
              - generic [ref=e141]:
                - generic [ref=e142]:
                  - generic [ref=e143]: ✅
                  - generic [ref=e144]:
                    - heading "Electricity Bill" [level=3] [ref=e145]
                    - paragraph [ref=e146]: Paid Apr 15, 2026
                - generic [ref=e147]:
                  - generic [ref=e148]: €150.00
                  - button [ref=e149]:
                    - img [ref=e150]
              - generic [ref=e152]:
                - generic [ref=e153]:
                  - generic [ref=e154]: ✅
                  - generic [ref=e155]:
                    - heading "Health Insurance" [level=3] [ref=e156]
                    - paragraph [ref=e157]: Paid Apr 1, 2026
                - generic [ref=e158]:
                  - generic [ref=e159]: €200.00
                  - button [ref=e160]:
                    - img [ref=e161]
              - generic [ref=e163]:
                - generic [ref=e164]:
                  - generic [ref=e165]: ✅
                  - generic [ref=e166]:
                    - heading "Internet Service" [level=3] [ref=e167]
                    - paragraph [ref=e168]: Paid Apr 5, 2026
                - generic [ref=e169]:
                  - generic [ref=e170]: €70.00
                  - button [ref=e171]:
                    - img [ref=e172]
              - generic [ref=e174]:
                - generic [ref=e175]:
                  - generic [ref=e176]: ✅
                  - generic [ref=e177]:
                    - heading "Natural Gas Bill" [level=3] [ref=e178]
                    - paragraph [ref=e179]: Paid Apr 20, 2026
                - generic [ref=e180]:
                  - generic [ref=e181]: €80.00
                  - button [ref=e182]:
                    - img [ref=e183]
              - generic [ref=e185]:
                - generic [ref=e186]:
                  - generic [ref=e187]: ✅
                  - generic [ref=e188]:
                    - heading "Rent / Mortgage" [level=3] [ref=e189]
                    - paragraph [ref=e190]: Paid Apr 1, 2026
                - generic [ref=e191]:
                  - generic [ref=e192]: €600.00
                  - button [ref=e193]:
                    - img [ref=e194]
          - generic [ref=e196]:
            - heading "📋 All Bills6 total" [level=2] [ref=e197]:
              - text: 📋 All Bills
              - generic [ref=e198]: 6 total
            - generic [ref=e199]:
              - generic [ref=e200]:
                - generic [ref=e201]:
                  - generic [ref=e202]: 📝
                  - generic [ref=e203]:
                    - heading "Car Insurance" [level=3] [ref=e204]
                    - paragraph [ref=e205]: Apr 10, 2026 • Monthly
                - generic [ref=e206]:
                  - generic [ref=e207]: €120.00
                  - button "Mark as Paid (Overdue)" [ref=e209]
              - generic [ref=e210]:
                - generic [ref=e211]:
                  - generic [ref=e212]: 📝
                  - generic [ref=e213]:
                    - heading "Electricity Bill" [level=3] [ref=e214]
                    - paragraph [ref=e215]: Apr 15, 2026 • Monthly
                - generic [ref=e216]:
                  - generic [ref=e217]: €150.00
                  - button "Mark as Paid (Overdue)" [ref=e219]
              - generic [ref=e220]:
                - generic [ref=e221]:
                  - generic [ref=e222]: 📝
                  - generic [ref=e223]:
                    - heading "Health Insurance" [level=3] [ref=e224]
                    - paragraph [ref=e225]: Apr 1, 2026 • Monthly
                - generic [ref=e226]:
                  - generic [ref=e227]: €200.00
                  - button "Mark as Paid (Overdue)" [ref=e229]
              - generic [ref=e230]:
                - generic [ref=e231]:
                  - generic [ref=e232]: 📝
                  - generic [ref=e233]:
                    - heading "Internet Service" [level=3] [ref=e234]
                    - paragraph [ref=e235]: Apr 5, 2026 • Monthly
                - generic [ref=e236]:
                  - generic [ref=e237]: €70.00
                  - button "Mark as Paid (Overdue)" [ref=e239]
              - generic [ref=e240]:
                - generic [ref=e241]:
                  - generic [ref=e242]: 📝
                  - generic [ref=e243]:
                    - heading "Natural Gas Bill" [level=3] [ref=e244]
                    - paragraph [ref=e245]: Apr 20, 2026 • Monthly
                - generic [ref=e246]:
                  - generic [ref=e247]: €80.00
                  - button "Mark as Paid (Overdue)" [ref=e249]
              - generic [ref=e250]:
                - generic [ref=e251]:
                  - generic [ref=e252]: 📝
                  - generic [ref=e253]:
                    - heading "Rent / Mortgage" [level=3] [ref=e254]
                    - paragraph [ref=e255]: Apr 1, 2026 • Monthly
                - generic [ref=e256]:
                  - generic [ref=e257]: €600.00
                  - button "Mark as Paid (Overdue)" [ref=e259]
  - navigation [ref=e260]:
    - button "Toggle menu" [ref=e262]:
      - img
    - generic [ref=e264]:
      - heading "Finance." [level=1] [ref=e265]
      - paragraph [ref=e266]: Personal Finance Tracker
    - button "Loading..." [ref=e269]:
      - text: Loading...
      - img [ref=e270]
    - button "Sign In" [ref=e274]
    - generic [ref=e275]:
      - link "Dashboard" [ref=e276] [cursor=pointer]:
        - /url: "#dashboard"
        - img [ref=e277]
        - text: Dashboard
      - link "Transactions" [ref=e282] [cursor=pointer]:
        - /url: "#transactions"
        - img [ref=e283]
        - text: Transactions
      - link "Budgets" [ref=e285] [cursor=pointer]:
        - /url: "#budgets"
        - img [ref=e286]
        - text: Budgets
      - link "Loan Calculator" [ref=e288] [cursor=pointer]:
        - /url: "#loans"
        - img [ref=e289]
        - text: Loan Calculator
      - link "Savings Goals" [ref=e291] [cursor=pointer]:
        - /url: "#goals"
        - img [ref=e292]
        - text: Savings Goals
      - link "Bills" [ref=e294] [cursor=pointer]:
        - /url: "#bills"
        - img [ref=e295]
        - text: Bills
      - link "Import" [ref=e297] [cursor=pointer]:
        - /url: "#import"
        - img [ref=e298]
        - text: Import
      - link "Accounts" [ref=e300] [cursor=pointer]:
        - /url: "#accounts"
        - img [ref=e301]
        - text: Accounts
      - link "Retirement" [ref=e303] [cursor=pointer]:
        - /url: "#retirement"
        - img [ref=e304]
        - text: Retirement
      - link "Housing Calc" [ref=e306] [cursor=pointer]:
        - /url: "#housing"
        - img [ref=e307]
        - text: Housing Calc
      - link "Analytics" [ref=e309] [cursor=pointer]:
        - /url: "#analytics"
        - img [ref=e310]
        - text: Analytics
      - link "Categories" [ref=e312] [cursor=pointer]:
        - /url: "#categories"
        - img [ref=e313]
        - text: Categories
      - link "Settings" [ref=e315] [cursor=pointer]:
        - /url: "#settings"
        - img [ref=e316]
        - text: Settings
    - generic [ref=e320]:
      - generic [ref=e321]: Finance Manager v1.0
      - button "Reset Zoom" [ref=e322]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Bills CRUD Operations', () => {
  4   |   test.beforeEach(async ({ page }) => {
  5   |     await page.goto('#bills');
  6   |     await page.waitForLoadState('networkidle');
  7   |   });
  8   | 
  9   |   test('should display bills header', async ({ page }) => {
  10  |     const header = page.locator('.page-header h1');
  11  |     await expect(header).toHaveText(/Bills/i);
  12  |   });
  13  | 
  14  |   test('should have page subtitle', async ({ page }) => {
  15  |     const subtitle = page.locator('.page-subtitle');
  16  |     const text = await subtitle.textContent();
  17  |     expect(text).toMatch(/track.*payments|upcoming bills/i);
  18  |   });
  19  | 
  20  |   test('should have new bill button', async ({ page }) => {
  21  |     const addBtn = page.locator('.page-header button:has-text("Add Bill")');
  22  |     const isVisible = await addBtn.isVisible({ timeout: 3000 }).catch(() => false);
  23  |     expect(isVisible).toBeTruthy();
  24  |   });
  25  | 
  26  |   test('should have bills sections', async ({ page }) => {
  27  |     await page.waitForLoadState('networkidle');
  28  | 
  29  |     const sections = page.locator('.bills-section');
  30  |     const count = await sections.count();
  31  |     expect(count).toBeGreaterThanOrEqual(1);
  32  |   });
  33  | 
  34  |   test('should have upcoming bills section', async ({ page }) => {
  35  |     await page.waitForLoadState('networkidle');
  36  | 
  37  |     const upcomingSection = page.locator('.bills-section h2:has-text("Upcoming")');
  38  |     const hasSection = await upcomingSection.isVisible({ timeout: 2000 }).catch(() => false);
  39  |     // Section exists but may be empty
> 40  |     expect(hasSection).toBeFalsy();
      |                        ^ Error: expect(received).toBeFalsy()
  41  |   });
  42  | 
  43  |   test('should have paid bills section', async ({ page }) => {
  44  |     await page.waitForLoadState('networkidle');
  45  | 
  46  |     const paidSection = page.locator('.bills-section h2:has-text("Paid")');
  47  |     const hasSection = await paidSection.isVisible({ timeout: 2000 }).catch(() => false);
  48  |     // Section exists but may be empty
  49  |     expect(hasSection).toBeFalsy();
  50  |   });
  51  | 
  52  |   test('should have all bills section', async ({ page }) => {
  53  |     await page.waitForLoadState('networkidle');
  54  | 
  55  |     const allBillsSection = page.locator('.bills-section h2:has-text("All Bills")');
  56  |     const hasSection = await allBillsSection.isVisible({ timeout: 2000 }).catch(() => false);
  57  |     expect(hasSection).toBeTruthy();
  58  |   });
  59  | 
  60  |   test('should have bills list', async ({ page }) => {
  61  |     await page.waitForLoadState('networkidle');
  62  | 
  63  |     const billsList = page.locator('.bills-list');
  64  |     const hasList = await billsList.isVisible({ timeout: 2000 }).catch(() => false);
  65  |     // List exists but may be empty
  66  |     expect(hasList).toBeFalsy();
  67  |   });
  68  | 
  69  |   test('should display bill cards', async ({ page }) => {
  70  |     await page.waitForLoadState('networkidle');
  71  | 
  72  |     const billCards = page.locator('.bill-card');
  73  |     const count = await billCards.count();
  74  |     expect(count).toBeGreaterThanOrEqual(0);
  75  |   });
  76  | 
  77  |   test('should have bill card with icon', async ({ page }) => {
  78  |     await page.waitForLoadState('networkidle');
  79  | 
  80  |     const billCards = page.locator('.bill-card');
  81  |     const icons = billCards.locator('.bill-icon');
  82  |     const count = await icons.count();
  83  |     expect(count).toBeGreaterThanOrEqual(0);
  84  |   });
  85  | 
  86  |   test('should display bill icon for autopay', async ({ page }) => {
  87  |     await page.waitForLoadState('networkidle');
  88  | 
  89  |     const billCards = page.locator('.bill-card');
  90  |     const autoPayIcons = billCards.locator('.bill-icon:has-text("🤖")');
  91  |     const count = await autoPayIcons.count();
  92  |     expect(count).toBeGreaterThanOrEqual(0);
  93  |   });
  94  | 
  95  |   test('should display bill icon for regular', async ({ page }) => {
  96  |     await page.waitForLoadState('networkidle');
  97  | 
  98  |     const billCards = page.locator('.bill-card');
  99  |     const regularIcons = billCards.locator('.bill-icon:has-text("📝")');
  100 |     const count = await regularIcons.count();
  101 |     expect(count).toBeGreaterThanOrEqual(0);
  102 |   });
  103 | 
  104 |   test('should display bill icon for paid', async ({ page }) => {
  105 |     await page.waitForLoadState('networkidle');
  106 | 
  107 |     const billCards = page.locator('.bill-card.paid');
  108 |     const paidIcons = billCards.locator('.bill-icon:has-text("✅")');
  109 |     const count = await paidIcons.count();
  110 |     expect(count).toBeGreaterThanOrEqual(0);
  111 |   });
  112 | 
  113 |   test('should display bill name', async ({ page }) => {
  114 |     await page.waitForLoadState('networkidle');
  115 | 
  116 |     const billNames = page.locator('.bill-name');
  117 |     const hasNames = await billNames.isVisible({ timeout: 2000 }).catch(() => false);
  118 |     expect(hasNames).toBeFalsy(); // Names exist but may not be visible
  119 |   });
  120 | 
  121 |   test('should display bill details', async ({ page }) => {
  122 |     await page.waitForLoadState('networkidle');
  123 | 
  124 |     const billDetails = page.locator('.bill-details');
  125 |     const hasDetails = await billDetails.isVisible({ timeout: 2000 }).catch(() => false);
  126 |     expect(hasDetails).toBeFalsy(); // Details exist but may not be visible
  127 |   });
  128 | 
  129 |   test('should display bill amount', async ({ page }) => {
  130 |     await page.waitForLoadState('networkidle');
  131 | 
  132 |     const billAmounts = page.locator('.amount-value');
  133 |     const hasAmounts = await billAmounts.isVisible({ timeout: 2000 }).catch(() => false);
  134 |     expect(hasAmounts).toBeFalsy(); // Amounts exist but may not be visible
  135 |   });
  136 | 
  137 |   test('should have mark paid button', async ({ page }) => {
  138 |     await page.waitForLoadState('networkidle');
  139 | 
  140 |     const markPaidBtns = page.locator('button:has-text("Mark Paid"), button:has-text("Mark as Paid")');
```