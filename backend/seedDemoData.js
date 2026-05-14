/**
 * Seed Demo Data — generates realistic demo profiles with transactions,
 * accounts, budgets, loans, portfolio holdings, and bills for self-hosted mode.
 * Mirrors the frontend idb.ts seedDemoProfiles() for parity.
 */

const DEMO_PROFILES = [
  { name: 'Example Low Income', income: 2500, spendFraction: 0.95 },
  { name: 'Example Mid Income', income: 5500, spendFraction: 0.82 },
  { name: 'Example High Income', income: 12000, spendFraction: 0.72 },
]

const DEFAULT_CATEGORIES = [
  { type: 'income', name: 'Salary', color: '#22C55E', icon: 'briefcase', tax_deductible: 0 },
  { type: 'income', name: 'Freelance', color: '#16A34A', icon: 'laptop', tax_deductible: 0 },
  { type: 'income', name: 'Investments', color: '#15803D', icon: 'chart', tax_deductible: 0 },
  { type: 'income', name: 'Gifts', color: '#86EFAC', icon: 'gift', tax_deductible: 0 },
  { type: 'expense', name: 'Housing', color: '#EF4444', icon: 'home', tax_deductible: 0 },
  { type: 'expense', name: 'Food', color: '#F97316', icon: 'food', tax_deductible: 0 },
  { type: 'expense', name: 'Transportation', color: '#EAB308', icon: 'car', tax_deductible: 0 },
  { type: 'expense', name: 'Utilities', color: '#8B5CF6', icon: 'bolt', tax_deductible: 0 },
  { type: 'expense', name: 'Healthcare', color: '#EC4899', icon: 'heart', tax_deductible: 1 },
  { type: 'expense', name: 'Entertainment', color: '#06B6D4', icon: 'film', tax_deductible: 0 },
  { type: 'expense', name: 'Insurance', color: '#3B82F6', icon: 'shield', tax_deductible: 0 },
  { type: 'expense', name: 'Shopping', color: '#D946EF', icon: 'bag', tax_deductible: 0 },
  { type: 'expense', name: 'Education', color: '#14B8A6', icon: 'book', tax_deductible: 1 },
  { type: 'expense', name: 'Subscriptions', color: '#F43F5E', icon: 'tv', tax_deductible: 0 },
]

const DEMO_ACCOUNTS = [
  { name: 'Checking Account', type: 'checking', currency: 'EUR' },
  { name: 'Savings Account', type: 'savings', currency: 'EUR' },
]

const MONTHLY_EXPENSES = [
  { name: 'Housing', description: 'Monthly rent', pct: 0.37 },
  { name: 'Food', description: 'Grocery shopping', pct: 0.21 },
  { name: 'Transportation', description: 'Transport pass', pct: 0.11 },
  { name: 'Utilities', description: 'Electric and water bill', pct: 0.08 },
  { name: 'Entertainment', description: 'Dining out', pct: 0.07 },
  { name: 'Shopping', description: 'Clothes and supplies', pct: 0.06 },
  { name: 'Insurance', description: 'Auto insurance', pct: 0.05 },
  { name: 'Subscriptions', description: 'Streaming services', pct: 0.05 },
]

function pseudoRand(seed, min, max) {
  const x = Math.sin(seed) * 10000
  const r = x - Math.floor(x)
  return Math.round(min + r * (max - min))
}

/**
 * Seed the database with demo profiles if no profiles exist.
 * @param {import('better-sqlite3').Database} db
 * @param {number} [userId=0] - user ID to associate profiles with (0 for demo/public mode)
 */
function seedDemoData(db, userId = 0) {
  const profileCount = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c
  if (profileCount > 0) return

  const insertProfile = db.prepare('INSERT INTO profiles (name, user_id, created_at) VALUES (?, ?, ?)')
  const insertCat = db.prepare(
    'INSERT INTO categories (profile_id, name, color, icon, type, tax_deductible) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertAccount = db.prepare(
    'INSERT INTO accounts (profile_id, name, type, currency, balance, starting_balance, starting_balance_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  const insertTx = db.prepare(
    'INSERT INTO transactions (profile_id, description, amount, type, category_id, date, currency, reconciled, notes, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const insertHolding = db.prepare(
    'INSERT INTO portfolio_holdings (profile_id, ticker, name, shares, purchase_price, purchase_date) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertLoan = db.prepare(
    'INSERT INTO loans (profile_id, name, principal, interest_rate, start_date, term_months) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertBudget = db.prepare(
    'INSERT INTO budgets (profile_id, category_id, amount, period, start_date, rollover_enabled) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertGoal = db.prepare(
    'INSERT INTO savings_goals (profile_id, name, target_amount, current_amount, deadline, notes) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const insertBill = db.prepare(
    'INSERT INTO bills (profile_id, name, amount, frequency, day_of_month, due_date, recurring, is_active, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )

  const seedAll = db.transaction(() => {
    for (const profile of DEMO_PROFILES) {
      const { lastInsertRowid: pid } = insertProfile.run(profile.name, userId, new Date().toISOString())

      // Categories
      const catMap = {}
      for (const cat of DEFAULT_CATEGORIES) {
        const { lastInsertRowid: catId } = insertCat.run(pid, cat.name, cat.color, cat.icon, cat.type, cat.tax_deductible)
        catMap[cat.name] = catId
      }

      // Accounts
      const savingsMult = profile.name.includes('Low') ? 0.2 : profile.name.includes('Mid') ? 1.0 : 2.5
      const accountIds = []
      for (const acct of DEMO_ACCOUNTS) {
        const multiplier = acct.type === 'checking' ? 0.3 : savingsMult
        const balance = Math.round(profile.income * multiplier)
        const { lastInsertRowid: acctId } = insertAccount.run(
          pid, acct.name, acct.type, acct.currency, balance, balance, '2020-01-01'
        )
        accountIds.push(acctId)
      }

      // Transactions from 2000-01 through current month
      const now = new Date()
      const startYear = 2000
      const endYear = now.getFullYear()
      const endMonth = now.getMonth()

      for (let year = startYear; year <= endYear; year++) {
        const lastMonth = year === endYear ? endMonth : 11
        for (let month = 0; month <= lastMonth; month++) {
          const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
          const daysInMonth = new Date(year, month + 1, 0).getDate()
          const yearIndex = year - startYear

          // Salary — grows 3% per year
          const salaryGrowth = Math.pow(1.03, yearIndex)
          const monthlyIncome = Math.round(profile.income * salaryGrowth)
          insertTx.run(
            pid, 'Monthly Salary', monthlyIncome, 'income', catMap['Salary'],
            `${monthStr}-01`, 'EUR', 1, '', accountIds[0]
          )

          // Expenses
          const totalMonthlySpend = Math.round(monthlyIncome * profile.spendFraction)
          for (const ex of MONTHLY_EXPENSES) {
            const catId = catMap[ex.name]
            if (!catId) continue
            const seed = year * 100 + month + MONTHLY_EXPENSES.indexOf(ex) * 1000
            const day = Math.min(pseudoRand(seed, 2, 28), daysInMonth - 1)
            const amount = Math.round(totalMonthlySpend * ex.pct * (0.85 + pseudoRand(seed + 1, 0, 30) / 100))
            if (amount <= 0) continue
            const reconciled = year < endYear || month < endMonth ? 1 : 0
            insertTx.run(
              pid, ex.description, amount, 'expense', catId,
              `${monthStr}-${String(day).padStart(2, '0')}`, 'EUR', reconciled, '', accountIds[0]
            )
          }
        }
      }

      // Portfolio holdings (Mid and High income only)
      if (!profile.name.includes('Low')) {
        const stocks = profile.name.includes('High')
          ? [
              { ticker: 'AAPL', shares: 50, price: 175, name: 'Apple Inc.' },
              { ticker: 'MSFT', shares: 30, price: 380, name: 'Microsoft Corp.' },
              { ticker: 'VWCE.DE', shares: 80, price: 95, name: 'Vanguard FTSE All-World' },
              { ticker: 'AMZN', shares: 20, price: 185, name: 'Amazon.com Inc.' },
            ]
          : [
              { ticker: 'VWCE.DE', shares: 25, price: 95, name: 'Vanguard FTSE All-World' },
              { ticker: 'AAPL', shares: 15, price: 175, name: 'Apple Inc.' },
            ]
        for (const h of stocks) {
          insertHolding.run(pid, h.ticker, h.name, h.shares, h.price, '2022-06-15')
        }
      }

      // Loans
      if (profile.name.includes('High')) {
        insertLoan.run(pid, 'Home Mortgage', 250000, 3.5, '2021-03-01', 240)
        // Also add a renovation loan for High profile
        insertLoan.run(pid, 'Home Renovation Loan', 35000, 5.2, '2023-01-15', 120)
      }
      if (profile.name.includes('Mid')) {
        insertLoan.run(pid, 'Car Loan', 18000, 4.9, '2022-08-01', 60)
      }

      // Budgets — set monthly budgets for key expense categories
      const budgetCategories = [
        { name: 'Housing', pct: 0.37 },
        { name: 'Food', pct: 0.21 },
        { name: 'Transportation', pct: 0.11 },
        { name: 'Entertainment', pct: 0.07 },
        { name: 'Shopping', pct: 0.06 },
        { name: 'Subscriptions', pct: 0.05 },
      ]
      for (const bc of budgetCategories) {
        const catId = catMap[bc.name]
        if (!catId) continue
        const budgetAmount = Math.round(profile.income * profile.spendFraction * bc.pct)
        insertBudget.run(pid, catId, budgetAmount, 'monthly', `${now.getFullYear()}-01-01`, 1)
      }

      // Savings goals
      const goals = profile.name.includes('High')
        ? [
            { name: 'Emergency Fund', target: 30000, current: 18500, deadline: `${now.getFullYear() + 2}-12-31`, notes: '6 months of expenses' },
            { name: 'Vacation', target: 8000, current: 3200, deadline: `${now.getFullYear()}-08-01`, notes: 'Summer trip to Japan' },
            { name: 'New Car', target: 40000, current: 12000, deadline: `${now.getFullYear() + 3}-06-01`, notes: 'Electric vehicle' },
          ]
        : profile.name.includes('Mid')
          ? [
              { name: 'Emergency Fund', target: 15000, current: 7500, deadline: `${now.getFullYear() + 1}-12-31`, notes: '3 months of expenses' },
              { name: 'Vacation', target: 4000, current: 1500, deadline: `${now.getFullYear()}-07-01`, notes: 'Weekend getaway' },
            ]
          : [
              { name: 'Emergency Fund', target: 5000, current: 2000, deadline: `${now.getFullYear() + 1}-12-31`, notes: 'Safety net' },
            ]
      for (const g of goals) {
        insertGoal.run(pid, g.name, g.target, g.current, g.deadline, g.notes)
      }

      // Bills
      const bills = [
        { name: 'Rent', amount: Math.round(profile.income * 0.28), dueDay: 1, recurring: 1, notes: 'Monthly rent payment', frequency: 'monthly' },
        { name: 'Electric Bill', amount: Math.round(profile.income * 0.03), dueDay: 15, recurring: 1, notes: 'Monthly electricity', frequency: 'monthly' },
        { name: 'Internet', amount: 45, dueDay: 10, recurring: 1, notes: 'Fiber internet', frequency: 'monthly' },
        { name: 'Phone Plan', amount: 35, dueDay: 5, recurring: 1, notes: 'Mobile phone plan', frequency: 'monthly' },
      ]
      for (const bill of bills) {
        const dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(bill.dueDay).padStart(2, '0')}`
        insertBill.run(pid, bill.name, bill.amount, bill.frequency, bill.dueDay, dueDate, bill.recurring, 1, bill.notes)
      }
    }
  })

  seedAll()
  console.log('[seed] Created 3 demo profiles with full transaction history (2000-present)')
}

module.exports = { seedDemoData }
