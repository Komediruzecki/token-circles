/**
 * The dataset every spec starts from.
 *
 * It used to be a `reseed-demo` call against the Express server, so what the tests were actually
 * looking at lived in a server's seed routine that nothing shipped, and a spec asserting on
 * "recent activity" could not be read without going to find it. This is the same data, written
 * where the tests are, through the API the app uses.
 *
 * Deliberately small. It exists to make pages render the states they have — a profile with
 * accounts is not pristine (so onboarding does not auto-open over everything), an unpaid and a
 * paid bill make both bill sections appear, recent transactions make the dashboard strip appear.
 * Specs that need particular data still create their own, in their own profile.
 */
import { expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

const DAY = 24 * 60 * 60 * 1000

// Two years, five transactions a month. The count matters: the transactions page paginates at 50
// rows, and the spec that asserts the pagination control appears needs "All time" to exceed one
// page. Four months did not.
const MONTHS_OF_HISTORY = 24

/** `days` ago, as YYYY-MM-DD. */
function isoDaysAgo(days: number, now: number): string {
  return new Date(now - days * DAY).toISOString().slice(0, 10)
}

async function post(api: APIRequestContext, path: string, profileId: number, data: unknown) {
  const res = await api.post(path, {
    headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(profileId) },
    data,
  })
  expect(res.ok(), `${path} -> ${res.status()} ${await res.text()}`).toBeTruthy()
  return res.json() as Promise<Record<string, unknown>>
}

export async function seedProfile(
  api: APIRequestContext,
  profileId: number,
  now = Date.now()
): Promise<void> {
  // Already seeded — the local D1 survives between runs, and re-seeding would stack duplicates.
  const existing = await api.get('/api/accounts', {
    headers: { 'X-Profile-Id': String(profileId) },
  })
  if (existing.ok() && ((await existing.json()) as unknown[]).length > 0) return

  // A new profile has no categories — nothing seeds defaults on create, and a categories page with
  // none of them renders its empty state instead of its grid.
  const categoryIds: Record<string, number> = {}
  const categories = [
    { name: 'Salary', type: 'income', icon: 'wallet', color: '#22c55e' },
    { name: 'Housing', type: 'expense', icon: 'home', color: '#6366f1' },
    { name: 'Groceries', type: 'expense', icon: 'cart', color: '#f59e0b' },
    { name: 'Subscriptions', type: 'expense', icon: 'repeat', color: '#ec4899' },
    { name: 'Eating out', type: 'expense', icon: 'coffee', color: '#14b8a6' },
    { name: 'Utilities', type: 'expense', icon: 'bolt', color: '#0ea5e9' },
  ]
  for (const c of categories) {
    const created = await post(api, '/api/categories', profileId, c)
    categoryIds[c.name] = Number(created.id)
  }

  const checking = await post(api, '/api/accounts', profileId, {
    name: 'Everyday Checking',
    type: 'giro',
    bank_name: 'Example Bank',
    starting_balance: 4200,
    starting_date: isoDaysAgo(365, now),
  })
  await post(api, '/api/accounts', profileId, {
    name: 'Rainy Day Savings',
    type: 'savings',
    bank_name: 'Example Bank',
    starting_balance: 15000,
    starting_date: isoDaysAgo(365, now),
  })

  const accountId = Number(checking.id)

  // Four months of a salary, and spending against it. The two subscriptions repeat on a monthly
  // cadence because the subscription scan looks for exactly that shape.
  const transactions: {
    description: string
    amount: number
    type: string
    days: number
    category: string
  }[] = []
  for (let monthsAgo = 0; monthsAgo < MONTHS_OF_HISTORY; monthsAgo += 1) {
    const base = monthsAgo * 30
    transactions.push(
      { description: 'Salary', amount: 3200, type: 'income', days: base + 2, category: 'Salary' },
      { description: 'Rent', amount: 1150, type: 'expense', days: base + 3, category: 'Housing' },
      {
        description: 'Weekly groceries',
        amount: 86.4,
        type: 'expense',
        days: base + 6,
        category: 'Groceries',
      },
      {
        description: 'Streamflix',
        amount: 9.99,
        type: 'expense',
        days: base + 11,
        category: 'Subscriptions',
      },
      {
        description: 'Coffee',
        amount: 4.2,
        type: 'expense',
        days: base + 14,
        category: 'Eating out',
      }
    )
  }

  for (const t of transactions) {
    await post(api, '/api/transactions', profileId, {
      description: t.description,
      amount: t.amount,
      type: t.type,
      date: isoDaysAgo(t.days, now),
      account_id: accountId,
      category_id: categoryIds[t.category],
    })
  }

  // Goals, loans and holdings. Their pages render an empty state without them, so every spec
  // asserting on a goal card or a loan row had nothing to find.
  await post(api, '/api/savings-goals', profileId, {
    name: 'Emergency fund',
    target_amount: 9600,
    current_amount: 5400,
    monthly_contribution: 300,
    deadline: isoDaysAgo(-420, now),
  })
  await post(api, '/api/savings-goals', profileId, {
    name: 'New laptop',
    target_amount: 2000,
    current_amount: 1850,
    monthly_contribution: 150,
    deadline: isoDaysAgo(-60, now),
  })

  await post(api, '/api/loans', profileId, {
    name: 'Car loan',
    principal: 18000,
    interest_rate: 4.9,
    start_date: isoDaysAgo(400, now),
    term_months: 60,
  })

  for (const h of [
    { ticker: 'VWCE', shares: 42, purchase_price: 108.4, days: 500 },
    { ticker: 'AAPL', shares: 12, purchase_price: 176.2, days: 320 },
    { ticker: 'MSFT', shares: 8, purchase_price: 402.1, days: 210 },
  ]) {
    await post(api, '/api/portfolio/holdings', profileId, {
      ticker: h.ticker,
      shares: h.shares,
      purchase_price: h.purchase_price,
      purchase_date: isoDaysAgo(h.days, now),
    })
  }

  // Budgets on the four spending categories that carry transactions, so the budgets page and
  // the dashboard's budget alerts have real progress to draw rather than an empty state. The
  // start date is the first of the current month: a budget's period is derived from it, so one
  // dated mid-month reads as a partial period and every figure on the page is a fraction.
  const today = new Date(now)
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)
  for (const b of [
    { category: 'Housing', amount: 1400 },
    { category: 'Groceries', amount: 450 },
    { category: 'Eating out', amount: 220 },
    { category: 'Utilities', amount: 180 },
  ]) {
    await post(api, '/api/budgets', profileId, {
      category_id: categoryIds[b.category],
      amount: b.amount,
      period: 'monthly',
      start_date: monthStart,
    })
  }

  // One of each, so both bill sections render. `mark-paid` is what actually makes a bill paid —
  // the field is derived from last_paid_date against the bill's frequency, not stored as a flag.
  await post(api, '/api/bills', profileId, {
    name: 'Internet',
    amount: 39.99,
    frequency: 'monthly',
    dueDate: isoDaysAgo(-9, now),
    account_id: accountId,
    category_id: categoryIds['Utilities'],
  })
  const electricity = await post(api, '/api/bills', profileId, {
    name: 'Electricity',
    amount: 74.5,
    frequency: 'monthly',
    dueDate: isoDaysAgo(4, now),
    account_id: accountId,
    category_id: categoryIds['Utilities'],
  })
  await post(api, `/api/bills/${Number(electricity.id)}/mark-paid`, profileId, {})
}
