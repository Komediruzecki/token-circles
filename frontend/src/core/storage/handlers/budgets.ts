/**
 * Budget handlers — IndexedDB-backed implementations for all /api/budgets routes.
 */
import {
  BUDGET_MESSAGES,
  checkAllocation,
  checkBudgetCreate,
  checkBudgetEdit,
  checkBudgetMonth,
  checkRollover,
} from '../../../../../shared/budgetSchema'
import { localMonth } from '../../../utils/period'
import { getDB } from '../idb'
import {
  adapter,
  currentProfileOwns,
  currentProfileRecord,
  endOfNextMonth,
  getAllForProfiles,
  getAmount,
  idParam,
  json,
  monthLabel,
  monthStart,
  nextMonth,
  notFound,
  ok,
  prevMonth,
  refuse,
} from './helpers'
import { normalizeBudget } from './normalize'
import type { BudgetDefaults } from '../../../../../shared/budgetSchema'

export async function budgetsList(): Promise<Response> {
  const budgets = await adapter.listBudgets()
  return json(budgets.map(normalizeBudget))
}

/** What a blank budget field means in local-first: the first of this month on this device. */
export function localBudgetDefaults(): BudgetDefaults {
  return { monthStart: `${localMonth()}-01` }
}

// The rules and their words are shared/budgetSchema.ts, which the Worker and the budget dialogs run
// too. Only the checked fields are stored: the body used to be stored as it came.
export async function budgetsCreate(body: unknown): Promise<Response> {
  const checked = checkBudgetCreate(body, localBudgetDefaults())
  if (!checked.ok) return refuse(checked.fields)
  if (!(await currentProfileOwns('categories', checked.value.category_id))) {
    return refuse({ category_id: BUDGET_MESSAGES.category })
  }
  const budget = {
    ...checked.value,
    rollover_amount: 0,
    profile_id: await adapter.getCurrentProfileId(),
  }
  const id = await adapter.createBudget(
    budget as unknown as Parameters<typeof adapter.createBudget>[0]
  )
  return json({ id, ...budget }, 201)
}

export async function budgetsGet(params: Record<string, string>): Promise<Response> {
  const budget = await currentProfileRecord('budgets', idParam(params))
  if (!budget) return notFound('Budget')
  return json(normalizeBudget(budget))
}

export async function budgetsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const id = idParam(params)
  const before = await currentProfileRecord('budgets', id)
  if (!before) return notFound('Budget')
  // Only the fields whose value the edit changes are checked and written (decision 2).
  const checked = checkBudgetEdit(body, before)
  if (!checked.ok) {
    console.error('[budgetsUpdate] Validation failed', { id, body, fields: checked.fields })
    return refuse(checked.fields)
  }
  const edit = checked.value
  if (
    edit.category_id !== undefined &&
    !(await currentProfileOwns('categories', edit.category_id))
  ) {
    return refuse({ category_id: BUDGET_MESSAGES.category })
  }
  if (Object.keys(edit).length > 0) {
    await adapter.updateBudget(id, edit as Parameters<typeof adapter.updateBudget>[1])
  }
  return ok()
}

export async function budgetsDelete(params: Record<string, string>): Promise<Response> {
  const id = idParam(params)
  if (!(await currentProfileRecord('budgets', id))) return notFound('Budget')
  await adapter.deleteBudget(id)
  return ok()
}

// ── Budget alerts ────────────────────────────────────────────────────────────

export async function budgetsAlerts(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pids = adapter.getCurrentProfileIds()
    const threshold = parseFloat(query.get('threshold')!) || 80

    let startDate: string
    let endDate: string
    if (query.get('year') && query.get('month')) {
      const y = parseInt(query.get('year')!)
      const m = parseInt(query.get('month')!)
      startDate = monthStart(y, m)
      const nm = nextMonth(y, m)
      endDate = monthStart(nm.year, nm.month)
    } else {
      const now = new Date()
      const y = now.getFullYear()
      const m = now.getMonth() + 1
      startDate = monthStart(y, m)
      const nm = nextMonth(y, m)
      endDate = monthStart(nm.year, nm.month)
    }

    const allBudgets: Record<string, unknown>[] = []
    const allTxns: Record<string, unknown>[] = []
    const allCats: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('budgets', 'by_profile', pid)
      allBudgets.push(...rows)
      const t = await db.getAllFromIndex('transactions', 'by_profile', pid)
      allTxns.push(...t)
      const c = await db.getAllFromIndex('categories', 'by_profile', pid)
      allCats.push(...c)
    }

    // The month's budgets: the rows that start in it, as the Worker reads them. It took every row
    // without an end date, so each earlier month's budget for a category, and each later one, was
    // measured against this month's spending, and one category raised an alert per month.
    const budgets = allBudgets.filter((b: Record<string, unknown>) => {
      const start = typeof b.start_date === 'string' ? b.start_date : ''
      return start >= startDate && start < endDate
    })

    const txns = allTxns.filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        t.category_id !== null &&
        (t.date as string) >= startDate &&
        (t.date as string) < endDate
    )

    const spentMap: Record<number, number> = {}
    for (const t of txns) {
      const cid = t.category_id as number
      spentMap[cid] = (spentMap[cid] || 0) + Math.abs(getAmount(t))
    }

    const catMap: Record<number, Record<string, unknown>> = {}
    for (const c of allCats) catMap[c.id as number] = c

    const alerts = budgets
      .map((b: Record<string, unknown>) => {
        const s = spentMap[b.category_id as number] || 0
        const amount = (b.amount as number) || 0
        const pct = amount > 0 ? (s / amount) * 100 : 0
        const rem = amount - s
        const cat = catMap[b.category_id as number]
        return {
          categoryId: b.category_id,
          categoryName: cat?.name,
          categoryColor: cat?.color,
          categoryIcon: cat?.icon,
          budgetAmount: amount,
          spent: s,
          remaining: rem,
          percentage: Math.round(pct),
          status: pct > 100 ? 'over' : pct >= threshold ? 'warning' : 'ok',
        }
      })
      .filter((b: Record<string, unknown>) => (b.percentage as number) >= threshold)
      .sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          (b.percentage as number) - (a.percentage as number)
      )

    return json({ alerts, threshold, startDate, endDate })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget history ───────────────────────────────────────────────────────────

export async function budgetsHistory(query: URLSearchParams): Promise<Response> {
  try {
    const categoryId = parseInt(query.get('category_id')!)
    const months = parseInt(query.get('months')!) || 6

    // Multi-profile (household) selection, mirroring budgetsList. category_id is
    // globally unique across profiles, so filtering by it selects the owning
    // profile's rows regardless of how many profiles are gathered.
    const budgets = (await getAllForProfiles('budgets'))
      .filter((b: Record<string, unknown>) => b.category_id === categoryId)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (b.start_date as string).localeCompare(a.start_date as string)
      )

    const txns = (await getAllForProfiles('transactions')).filter(
      (t: Record<string, unknown>) => t.type === 'expense' && t.category_id === categoryId
    )

    // Bucket this category's expenses by YYYY-MM in ONE pass so each budget row
    // is a map lookup rather than a full rescan. A budget window is
    // [start_date, endOfNextMonth(start_date)); for a 1st-of-month start_date
    // that equals the calendar month start_date.slice(0, 7), making the lookup
    // byte-for-byte equal to the original filter+reduce. Non-1st start_dates
    // fall back to the exact windowed reduce so results never change.
    const spentByMonth = new Map<string, number>()
    for (const t of txns) {
      const mo = (t.date as string).slice(0, 7)
      spentByMonth.set(mo, (spentByMonth.get(mo) ?? 0) + getAmount(t))
    }

    const history = budgets.slice(0, months).map((b: Record<string, unknown>) => {
      const start = b.start_date as string
      let spent: number
      if (start.slice(8, 10) === '01') {
        spent = spentByMonth.get(start.slice(0, 7)) ?? 0
      } else {
        const end = endOfNextMonth(start)
        spent = txns
          .filter(
            (t: Record<string, unknown>) => (t.date as string) >= start && (t.date as string) < end
          )
          .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)
      }
      return { month: start, budget_amount: b.amount, spent }
    })

    return json(history)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget improvements ──────────────────────────────────────────────────────

/**
 * What each budget's category spent in the budget's month, as the Worker's join counts it: the
 * category's expenses from the budget's start date to the same day a month on. A month's trend
 * and adherence compare the budgets with this, not with every expense of the month: spending in a
 * category without a budget, or without a category, has no budget to be measured against.
 */
function budgetSpending(
  txns: Record<string, unknown>[]
): (budget: Record<string, unknown>) => number {
  const byCategoryMonth = new Map<string, number>()
  for (const t of txns) {
    if (t.type !== 'expense' || t.category_id === null || t.category_id === undefined) continue
    const key = `${Number(t.category_id)} ${(t.date as string).slice(0, 7)}`
    byCategoryMonth.set(key, (byCategoryMonth.get(key) ?? 0) + getAmount(t))
  }
  return (budget) => {
    const start = budget.start_date as string
    // A budget that starts on the 1st spends in its calendar month: one lookup.
    if (start.slice(8, 10) === '01') {
      return byCategoryMonth.get(`${Number(budget.category_id)} ${start.slice(0, 7)}`) ?? 0
    }
    const end = endOfNextMonth(start)
    return txns
      .filter(
        (t) =>
          t.type === 'expense' &&
          t.category_id === budget.category_id &&
          (t.date as string) >= start &&
          (t.date as string) < end
      )
      .reduce((sum, t) => sum + getAmount(t), 0)
  }
}

export async function budgetsImprovements(query: URLSearchParams): Promise<Response> {
  try {
    const numMonths = parseInt(query.get('months')!) || 6

    // Multi-profile (household) selection, mirroring budgetsList: aggregate across
    // all selected profiles so the summary matches the list's profile scope.
    const budgets = await getAllForProfiles('budgets')
    const txns = await getAllForProfiles('transactions')

    // Each month's budgets, and what their categories spent: every expense of the month was
    // counted, unbudgeted and uncategorised included, where the Worker counts the budgeted
    // categories' (the contract's `budget-trend-spending`).
    const spentOf = budgetSpending(txns)
    const monthlyMap: Record<string, { budget: number; spent: number }> = {}
    for (const b of budgets) {
      const mo = (b.start_date as string).slice(0, 7)
      if (!monthlyMap[mo]) monthlyMap[mo] = { budget: 0, spent: 0 }
      monthlyMap[mo].budget += (b.amount as number) || 0
      monthlyMap[mo].spent += spentOf(b)
    }

    const months = Object.keys(monthlyMap).sort().reverse().slice(0, numMonths)
    const history = months.map((mo, idx) => {
      const d = monthlyMap[mo]
      const prev = months[idx + 1] ? monthlyMap[months[idx + 1]] : null
      const adherence = d.budget > 0 ? (d.spent / d.budget) * 100 : 0
      const prevAdherence = prev && prev.budget > 0 ? (prev.spent / prev.budget) * 100 : null
      return {
        month: mo,
        total_budget: d.budget,
        total_spent: d.spent,
        adherence_pct: adherence,
        prev_adherence: prevAdherence,
        change_pct: prevAdherence !== null ? adherence - prevAdherence : null,
      }
    })

    if (history.length > 0) {
      const latestMo = history[0].month
      const cats = await getAllForProfiles('categories')
      const catMap: Record<number, Record<string, unknown>> = {}
      for (const c of cats) catMap[c.id as number] = c

      const latestBudgets = budgets.filter(
        (b: Record<string, unknown>) => (b.start_date as string).slice(0, 7) === latestMo
      )
      const catBreakdown = latestBudgets
        .map((b: Record<string, unknown>) => {
          const cat = catMap[b.category_id as number]
          return {
            name: cat?.name,
            color: cat?.color,
            budget_amount: b.amount,
          }
        })
        .sort(
          (a: Record<string, unknown>, b: Record<string, unknown>) =>
            (b.budget_amount as number) - (a.budget_amount as number)
        )
      ;(history[0] as Record<string, unknown>).category_budgets = JSON.stringify(catBreakdown)
    }

    return json(history)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget summary ───────────────────────────────────────────────────────────

export async function budgetsSummary(query: URLSearchParams): Promise<Response> {
  try {
    const now = new Date()
    const y = parseInt(query.get('year')!) || now.getFullYear()
    const m = parseInt(query.get('month')!) || now.getMonth() + 1

    const startDate = monthStart(y, m)
    const nm = nextMonth(y, m)
    const endDate = monthStart(nm.year, nm.month)

    const pm = prevMonth(y, m)
    const prevStart = monthStart(pm.year, pm.month)

    // Multi-profile (household) selection, mirroring budgetsList so the summary
    // covers the same profiles as the list.
    const allBudgets = await getAllForProfiles('budgets')
    const allTxns = await getAllForProfiles('transactions')

    // D13: budgetsAllocate writes one row per month with no end_date, so the old
    // `!end_date || end_date >= startDate` filter stacked every prior month's row
    // for a category. Restrict to budgets whose start_date falls in the queried
    // month (mirrors budgetsZeroBased) — exactly one row per category per month.
    const budgets = allBudgets.filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= startDate && (b.start_date as string) < endDate
    )

    const txns = allTxns.filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        t.category_id !== null &&
        (t.date as string) >= startDate &&
        (t.date as string) < endDate
    )

    const prevTxns = allTxns.filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        t.category_id !== null &&
        (t.date as string) >= prevStart &&
        (t.date as string) < startDate
    )

    const spentMap: Record<number, number> = {}
    for (const t of txns) {
      const cid = t.category_id as number
      spentMap[cid] = (spentMap[cid] || 0) + getAmount(t)
    }

    const prevSpentMap: Record<number, number> = {}
    for (const t of prevTxns) {
      const cid = t.category_id as number
      prevSpentMap[cid] = (prevSpentMap[cid] || 0) + getAmount(t)
    }

    const prevBudgets = allBudgets.filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= prevStart && (b.start_date as string) < startDate
    )

    const prevUnusedMap: Record<number, { unused: number; rollover_enabled: boolean }> = {}
    for (const pb of prevBudgets) {
      const unused = Math.max(
        0,
        (pb.amount as number) - (prevSpentMap[pb.category_id as number] || 0)
      )
      prevUnusedMap[pb.category_id as number] = {
        unused,
        rollover_enabled: !!(pb as Record<string, unknown>).rollover_enabled,
      }
    }

    const cats = await getAllForProfiles('categories')
    const catMap: Record<number, Record<string, unknown>> = {}
    for (const c of cats) catMap[c.id as number] = c

    const summary = budgets.map((b: Record<string, unknown>) => {
      const spentAmt = spentMap[b.category_id as number] || 0
      const baseRemaining = (b.amount as number) - spentAmt
      const cat = catMap[b.category_id as number]

      let rollover_contribution = 0
      let auto_rollover = 0
      const re = !!(b as Record<string, unknown>).rollover_enabled

      if (re) {
        const prevInfo = prevUnusedMap[b.category_id as number]
        if (prevInfo && prevInfo.rollover_enabled) {
          auto_rollover = prevInfo.unused
        }
        rollover_contribution =
          (((b as Record<string, unknown>).rollover_amount as number) || 0) +
          auto_rollover -
          (((b as Record<string, unknown>).rollover_used as number) || 0)
      }

      const effective_budget = (b.amount as number) + Math.max(0, rollover_contribution)
      const effective_remaining = effective_budget - spentAmt

      return {
        ...b,
        category_name: cat?.name,
        category_color: cat?.color,
        category_icon: cat?.icon,
        type: cat?.type,
        spent: spentAmt,
        remaining: baseRemaining,
        effective_budget,
        effective_remaining,
        rollover_contribution: Math.max(0, rollover_contribution),
        auto_rollover,
        percentage:
          (b.amount as number) > 0 ? Math.min(100, (spentAmt / (b.amount as number)) * 100) : 0,
      }
    })

    return json(summary)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Zero-based budgeting ─────────────────────────────────────────────────────

export async function budgetsZeroBased(query: URLSearchParams): Promise<Response> {
  try {
    const month = query.get('month') || localMonth()
    const startOfMonth = `${month}-01`
    const endOfMonth = endOfNextMonth(startOfMonth)

    // Multi-profile (household) selection, mirroring budgetsList.
    const cats = (await getAllForProfiles('categories'))
      .filter((c: Record<string, unknown>) => c.type === 'expense')
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (a.name as string).localeCompare(b.name as string)
      )

    const budgets = (await getAllForProfiles('budgets')).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= startOfMonth &&
        (b.start_date as string) < endOfMonth &&
        b.period === 'monthly'
    )

    const budgetMap: Record<number, Record<string, unknown>> = {}
    for (const b of budgets) budgetMap[b.category_id as number] = b

    const txns = await getAllForProfiles('transactions')
    const spentMap: Record<number, number> = {}
    for (const t of txns) {
      if (t.type !== 'expense' || !t.category_id) continue
      if ((t.date as string) >= startOfMonth && (t.date as string) < endOfMonth) {
        spentMap[t.category_id as number] =
          (spentMap[t.category_id as number] || 0) + Math.abs(getAmount(t))
      }
    }

    const income = txns
      .filter(
        (t: Record<string, unknown>) =>
          t.type === 'income' &&
          (t.date as string) >= startOfMonth &&
          (t.date as string) < endOfMonth
      )
      .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)

    let alreadyBudgeted = 0
    for (const b of budgets) alreadyBudgeted += (b.amount as number) || 0
    const unassignedBudget = Math.max(0, income - alreadyBudgeted)

    // A category without a budget has none: an amount of 0 and nothing used, as on the Worker. Its
    // spending was given as its budget, 100% used, so the Budgets page called it near its limit in
    // local-first only (the contract's `budget-zero-based-unbudgeted`).
    const allocations = cats.map((cat: Record<string, unknown>) => {
      const budget = budgetMap[cat.id as number]
      const spentAmt = spentMap[cat.id as number] || 0
      const budgetAmount = (budget?.amount as number) || 0
      const remainingBudget = budget ? budgetAmount - spentAmt : 0
      const percentUsed = budget && budgetAmount > 0 ? (spentAmt / budgetAmount) * 100 : 0

      return {
        budget_id: budget?.id ?? null,
        category_id: cat.id,
        category_name: cat.name,
        category_color: cat.color,
        category_icon: cat.icon,
        amount: budgetAmount,
        spent: spentAmt,
        remaining_budget: remainingBudget,
        percent_used: Math.min(100, Math.round(percentUsed)),
        is_budgeted: !!budget,
        can_allocate: unassignedBudget > 0,
        rollover_enabled: !!(budget as Record<string, unknown>)?.rollover_enabled,
      }
    })

    return json({
      categories: cats.map((c: Record<string, unknown>) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
      })),
      allocations,
      remaining_income: income,
      alreadyBudgeted,
      unassigned_budget: unassignedBudget,
      period: month,
      can_allocate: unassignedBudget > 0,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Zero-based budget summary ───────────────────────────────────────────────

export async function budgetsZeroBasedSummary(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const month = query.get('month') || localMonth()
    const startOfMonth = `${month}-01`
    const endOfMonth = endOfNextMonth(startOfMonth)

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= startOfMonth &&
        (b.start_date as string) < endOfMonth &&
        b.period === 'monthly'
    )

    const txns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    const spentMap: Record<number, number> = {}
    for (const t of txns) {
      if (t.type !== 'expense' || !t.category_id) continue
      if ((t.date as string) >= startOfMonth && (t.date as string) < endOfMonth) {
        spentMap[t.category_id as number] =
          (spentMap[t.category_id as number] || 0) + Math.abs(getAmount(t))
      }
    }

    const income = txns
      .filter(
        (t: Record<string, unknown>) =>
          t.type === 'income' &&
          (t.date as string) >= startOfMonth &&
          (t.date as string) < endOfMonth
      )
      .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)

    const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
    const catMap: Record<number, Record<string, unknown>> = {}
    for (const c of cats) catMap[c.id as number] = c

    const totalBudget = budgets.reduce(
      (sum: number, b: Record<string, unknown>) => sum + ((b.amount as number) || 0),
      0
    )
    const totalSpent = Object.values(spentMap).reduce((sum: number, val: number) => sum + val, 0)
    const remaining = totalBudget - totalSpent
    const zero_based_remaining = income - totalBudget

    const summary = budgets.map((b: Record<string, unknown>) => {
      const cat = catMap[b.category_id as number]
      const s = spentMap[b.category_id as number] || 0
      const amt = (b.amount as number) || 0
      const pct = amt > 0 ? (s / amt) * 100 : 0
      return {
        budget_id: b.id,
        category_id: b.category_id,
        category_name: cat?.name,
        category_color: cat?.color,
        category_icon: cat?.icon,
        allocated: amt,
        spent: s,
        remaining: amt - s,
        percent_used: pct,
        status: s > amt ? 'over' : 'ok',
        is_fully_allocated: amt > 0 && s <= amt,
        rollover_enabled: !!(b as Record<string, unknown>).rollover_enabled,
        alerts: [] as string[],
        is_unallocated: false,
      }
    })

    if (zero_based_remaining > 0) {
      summary.push({
        budget_id: 0,
        category_id: 0,
        category_name: 'Unallocated / Future',
        category_color: '#9ca3af',
        category_icon: 'wallet',
        allocated: 0,
        spent: 0,
        remaining: zero_based_remaining,
        percent_used: 0,
        status: 'ok',
        is_fully_allocated: true,
        rollover_enabled: false,
        alerts: [
          'You have unallocated income. Consider adding a savings allocation or increase existing budgets.',
        ],
        is_unallocated: true,
      })
    }

    // Over budget is spending past the allocation, as `status` says: not at exactly 100%, where
    // this said "Over budget by $0.00" (the contract's `budget-allocation-alerts`).
    for (const item of summary) {
      if (item.percent_used >= 90) {
        item.alerts.push(`Approaching limit: ${Math.round(item.percent_used)}% used`)
      }
      if (item.percent_used > 100) {
        item.alerts.push(`Over budget by $${(-item.remaining).toFixed(2)}`)
      }
    }

    return json({
      allocations: summary,
      total_budget: totalBudget,
      total_spent: totalSpent,
      remaining,
      zero_based_remaining,
      income,
      period: month,
      can_allocate: zero_based_remaining > 0,
      unassigned_budget: zero_based_remaining,
      already_budgeted: totalBudget,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget allocate ──────────────────────────────────────────────────────────

export async function budgetsAllocate(query: URLSearchParams, body: unknown): Promise<Response> {
  try {
    const pid = await adapter.getCurrentProfileId()
    const checkedMonth = checkBudgetMonth(query.get('month'), localMonth())
    if (!checkedMonth.ok) return refuse(checkedMonth.fields)
    const checked = checkAllocation(body)
    if (!checked.ok) return refuse(checked.fields)
    const { category_id, amount, period: budgetPeriod } = checked.value
    // A household view lists every selected profile's categories; the budget is the current
    // profile's, so it may only be for one of its own (as the Worker's allocate checks).
    if (!(await currentProfileOwns('categories', category_id, pid))) {
      return refuse({ category_id: BUDGET_MESSAGES.category })
    }

    const start_date = `${checkedMonth.value}-01`

    const db = await getDB()
    const existing = (await db.getAllFromIndex('budgets', 'by_profile', pid)).find(
      (b: Record<string, unknown>) =>
        b.category_id === category_id && b.start_date === start_date && b.period === budgetPeriod
    )

    // Allocate is an upsert: re-allocating a category for the same month updates the amount
    // instead of erroring, so users can freely change an allocation from the same action.
    if (existing) {
      await adapter.updateBudget(existing.id as number, { amount })
      return json({
        id: existing.id,
        category_id,
        amount,
        period: budgetPeriod,
        start_date,
        profile_id: pid,
        message: 'Budget updated successfully',
      })
    }

    const id = await adapter.createBudget({
      category_id,
      amount,
      period: budgetPeriod,
      start_date,
      profile_id: pid,
      rollover_enabled: false,
      rollover_amount: 0,
    } as Parameters<typeof adapter.createBudget>[0])

    return json({
      id,
      category_id,
      amount,
      period: budgetPeriod,
      start_date,
      profile_id: pid,
      message: 'Budget allocated successfully',
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget rollover ──────────────────────────────────────────────────────────

export async function budgetsRollover(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const id = idParam(params)

    const checked = checkRollover(body)
    if (!checked.ok) return refuse(checked.fields)
    const { rollover_amount, rollover_used, rollover_enabled } = checked.value

    const budget = await db.get('budgets', id)
    if (!budget || (budget.profile_id as number) !== pid) {
      return json({ error: 'Budget not found' }, 404)
    }

    if (rollover_amount !== undefined) budget.rollover_amount = rollover_amount
    if (rollover_used !== undefined) budget.rollover_used = rollover_used
    if (rollover_enabled !== undefined) budget.rollover_enabled = rollover_enabled

    await db.put('budgets', budget)

    return json({ ok: true, budget })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget from-expenses ─────────────────────────────────────────────────────
// Sets budgets for the month from last month's spending, for the categories the month has no
// budget for yet. It used to delete the month's budgets first and write last month's spending in
// their place, without asking. Like "Copy last month", it never deletes or overwrites a budget the
// month has, and says how many it set and how many already had one. The Worker's twin is
// POST /api/budgets/from-expenses in worker/src/routes/budgets.ts.

export async function budgetsFromExpenses(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()

    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const { year, month } = body as Record<string, unknown>

    const targetYear = (year as number) || new Date().getFullYear()
    const targetMonth = (month as number) || new Date().getMonth() + 1

    const pm = prevMonth(targetYear, targetMonth)
    const prevStart = monthStart(pm.year, pm.month)
    const currStart = monthStart(targetYear, targetMonth)
    const nm = nextMonth(targetYear, targetMonth)
    const currEnd = monthStart(nm.year, nm.month)

    // The profile's own categories, as the Worker's JOIN reads them: spending on a category that
    // is gone sets no budget.
    const categories = new Set(
      (await db.getAllFromIndex('categories', 'by_profile', pid)).map((c) => c.id as number)
    )
    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        categories.has(t.category_id as number) &&
        (t.date as string) >= prevStart &&
        (t.date as string) < currStart
    )

    const expensesByCat = new Map<number, number>()
    for (const t of txns) {
      const cid = t.category_id as number
      expensesByCat.set(cid, (expensesByCat.get(cid) ?? 0) + getAmount(t))
    }
    if (expensesByCat.size === 0) {
      return json({ ok: false, message: 'No expenses found for previous month' })
    }

    // Read and write in one transaction, so the month's budgets cannot change in between.
    const tx = db.transaction('budgets', 'readwrite')
    const budgeted = new Set(
      (await tx.store.index('by_profile').getAll(pid))
        .filter(
          (b: Record<string, unknown>) =>
            (b.start_date as string) >= currStart && (b.start_date as string) < currEnd
        )
        .map((b: Record<string, unknown>) => b.category_id as number)
    )
    const createdAt = new Date().toISOString()
    let count = 0
    for (const [categoryId, total] of expensesByCat) {
      if (budgeted.has(categoryId)) continue
      await tx.store.add({
        category_id: categoryId,
        amount: Math.round(total * 100) / 100,
        period: 'monthly',
        start_date: currStart,
        end_date: null,
        profile_id: pid,
        rollover_enabled: false,
        rollover_amount: 0,
        created_at: createdAt,
      })
      count++
    }
    await tx.done

    return json({ ok: true, count, already_budgeted: expensesByCat.size - count })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget backfill-from-spending ─────────────────────────────────────────────
// For every month in the range, set each category's monthly budget to that month's
// actual spending. Fills historical months so charts aren't empty after an import.
// Overwrites budgets in the range. from_month/to_month are 'YYYY-MM'; omit for full range.
export async function budgetsBackfillFromSpending(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    const monthRe = /^\d{4}-\d{2}$/
    let fromMonth =
      typeof b.from_month === 'string' && monthRe.test(b.from_month) ? b.from_month : null
    let toMonth = typeof b.to_month === 'string' && monthRe.test(b.to_month) ? b.to_month : null

    const allTxns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) => t.type === 'expense' && t.category_id !== null
    )
    if (allTxns.length === 0) return json({ ok: false, message: 'No expenses to backfill' })

    if (!fromMonth || !toMonth) {
      let minM = '9999-99'
      let maxM = '0000-00'
      for (const t of allTxns) {
        const ym = (t.date as string).slice(0, 7)
        if (ym < minM) minM = ym
        if (ym > maxM) maxM = ym
      }
      fromMonth = fromMonth || minM
      toMonth = toMonth || maxM
    }

    // Per (month, category) spending within the range.
    const totals: Record<string, Record<number, number>> = {}
    for (const t of allTxns) {
      const ym = (t.date as string).slice(0, 7)
      if (ym < fromMonth || ym > toMonth) continue
      const cid = t.category_id as number
      totals[ym] = totals[ym] || {}
      totals[ym][cid] = (totals[ym][cid] || 0) + getAmount(t)
    }

    const monthsList = Object.keys(totals)
    if (monthsList.length === 0) {
      return json({ ok: false, message: 'No expenses in the selected range' })
    }

    const fromStart = `${fromMonth}-01`
    const [ty, tm] = toMonth.split('-').map(Number)
    const toEnd = tm === 12 ? `${ty + 1}-01-01` : `${ty}-${String(tm + 1).padStart(2, '0')}-01`

    const existing = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (bb: Record<string, unknown>) =>
        (bb.start_date as string) >= fromStart && (bb.start_date as string) < toEnd
    )

    const tx = db.transaction('budgets', 'readwrite')
    for (const bb of existing) await tx.store.delete(bb.id as number)
    let count = 0
    const createdAt = new Date().toISOString()
    for (const ym of monthsList) {
      for (const [catId, total] of Object.entries(totals[ym])) {
        await tx.store.add({
          category_id: parseInt(catId),
          amount: total,
          period: 'monthly',
          start_date: `${ym}-01`,
          end_date: null,
          profile_id: pid,
          rollover_enabled: false,
          rollover_amount: 0,
          created_at: createdAt,
        })
        count++
      }
    }
    await tx.done

    return json({ ok: true, count, months: monthsList.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget duplicate-last ────────────────────────────────────────────────────

export async function budgetsDuplicateLast(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()

    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const { year, month } = body as Record<string, unknown>

    const targetYear = (year as number) || new Date().getFullYear()
    const targetMonth = (month as number) || new Date().getMonth() + 1

    const pm = prevMonth(targetYear, targetMonth)
    const prevStart = monthStart(pm.year, pm.month)
    const prevEnd = monthStart(targetYear, targetMonth)

    const prevBudgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= prevStart && (b.start_date as string) < prevEnd
    )

    if (prevBudgets.length === 0) {
      return json({ ok: false, message: 'No budgets found for previous month' })
    }

    const currStart = monthStart(targetYear, targetMonth)
    const currEnd = monthStart(
      targetMonth === 12 ? targetYear + 1 : targetYear,
      targetMonth === 12 ? 1 : targetMonth + 1
    )

    const existingBudgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= currStart && (b.start_date as string) < currEnd
    )

    // A budget the month already has is never replaced: only a category with no budget in it yet
    // gets last month's, one budget per category (the newest, should last month hold two), with
    // its rollover switch. A rollover amount set by hand is not copied: it was carried into last
    // month, and this month rolls over what last month left unspent instead. The answer says how
    // many were copied and how many categories already had one. (This deleted the month's budgets
    // first, so a copy overwrote the amounts a person had set and dropped the categories last
    // month did not budget.)
    const already = new Set(
      existingBudgets.map((b: Record<string, unknown>) => Number(b.category_id))
    )
    const copies = new Map<number, Record<string, unknown>>()
    for (const b of prevBudgets as Record<string, unknown>[]) {
      if (!already.has(Number(b.category_id))) copies.set(Number(b.category_id), b)
    }
    const alreadyBudgeted = new Set(
      prevBudgets
        .map((b: Record<string, unknown>) => Number(b.category_id))
        .filter((id: number) => already.has(id))
    ).size

    const tx = db.transaction('budgets', 'readwrite')
    const createdAt = new Date().toISOString()
    for (const b of copies.values()) {
      await tx.store.add({
        category_id: b.category_id,
        amount: b.amount,
        period: b.period,
        start_date: currStart,
        end_date: null,
        profile_id: pid,
        rollover_enabled: b.rollover_enabled || false,
        rollover_amount: 0,
        created_at: createdAt,
      })
    }
    await tx.done

    return json({ ok: true, count: copies.size, already_budgeted: alreadyBudgeted })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget forecast ──────────────────────────────────────────────────────────

export async function budgetsForecast(query: URLSearchParams): Promise<Response> {
  try {
    const month = query.get('month') || localMonth()

    // Multi-profile (household) selection, mirroring budgetsList. Every budget up to and including
    // `month`, compared as months: '2026-10-01' sorts after '2026-10' as a string.
    const budgets = (await getAllForProfiles('budgets'))
      .filter((b: Record<string, unknown>) => (b.start_date as string).slice(0, 7) <= month)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (b.start_date as string).localeCompare(a.start_date as string)
      )

    if (budgets.length === 0) {
      return json({
        period: month,
        history: [],
        forecast: [],
        total_budget: 0,
        avg_adherence: 0,
      })
    }

    const txns = await getAllForProfiles('transactions')

    // Precompute expense totals bucketed by (category_id, YYYY-MM) in ONE pass
    // over the transactions, instead of rescanning the full list per budget.
    // A budget's spend window is [start_date, endOfNextMonth(start_date)); when
    // start_date is the 1st of its month that window is exactly the calendar
    // month start_date.slice(0, 7), so the bucket lookup is byte-for-byte equal
    // to the original filter+reduce. For any budget whose start_date is not the
    // 1st (windows can then straddle two months), fall back to the exact
    // per-window reduce so results never change.
    const spentByCatMonth = new Map<string, number>()
    for (const t of txns) {
      if (t.type !== 'expense') continue
      const cid = t.category_id as number | null
      const k = `${cid} ${(t.date as string).slice(0, 7)}`
      spentByCatMonth.set(k, (spentByCatMonth.get(k) ?? 0) + getAmount(t))
    }

    const catAvgs: Record<number, { total: number; count: number; avgAmount: number }> = {}
    for (const b of budgets) {
      const cid = b.category_id as number
      if (!catAvgs[cid]) catAvgs[cid] = { total: 0, count: 0, avgAmount: 0 }

      const bStart = b.start_date as string
      let spent: number
      if (bStart.slice(8, 10) === '01') {
        spent = spentByCatMonth.get(`${cid} ${bStart.slice(0, 7)}`) ?? 0
      } else {
        const bEnd = endOfNextMonth(bStart)
        spent = txns
          .filter(
            (t: Record<string, unknown>) =>
              t.type === 'expense' &&
              t.category_id === cid &&
              (t.date as string) >= bStart &&
              (t.date as string) < bEnd
          )
          .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)
      }
      if (spent > 0) {
        catAvgs[cid].total += spent
        catAvgs[cid].count += 1
      }
    }
    for (const cid in catAvgs) {
      if (catAvgs[cid].count > 0) catAvgs[cid].avgAmount = catAvgs[cid].total / catAvgs[cid].count
    }

    const now = new Date()
    const forecastMonths = []
    for (let i = 1; i <= 6; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1)
      forecastMonths.push({
        // Local midnight on the 1st, so the local month: toISOString() is the UTC one, which east
        // of UTC is the month before and named this month as the first month ahead.
        month: localMonth(date),
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      })
    }

    const forecastData = forecastMonths.map((fm) => {
      const fmMonthStr = `${fm.month}-01`
      const currentBudget =
        budgets.find((b: Record<string, unknown>) => b.start_date === fmMonthStr) ||
        budgets[budgets.length - 1]
      const cid = currentBudget.category_id as number
      const avgSpending = catAvgs[cid]
        ? catAvgs[cid].avgAmount
        : (currentBudget.amount as number) * 0.5

      const monthDiff =
        (parseInt(fm.month.slice(0, 4)) - now.getFullYear()) * 12 +
        parseInt(fm.month.slice(5, 7)) -
        (now.getMonth() + 1)
      const inflationFactor = Math.pow(1.03, Math.max(0, monthDiff))

      const predictedSpent = avgSpending * inflationFactor
      const budgetAmount = (currentBudget.amount as number) || 0
      const adherence = budgetAmount > 0 ? Math.min(100, (predictedSpent / budgetAmount) * 100) : 0
      const status = adherence > 100 ? 'over' : adherence >= 80 ? 'warning' : 'ok'

      return {
        month: fm.month,
        label: fm.label,
        budget_amount: budgetAmount,
        predicted_spent: predictedSpent,
        adherence,
        status,
        forecast_remaining: Math.max(0, budgetAmount - predictedSpent),
      }
    })

    // The months' budgets against what their categories spent, as in budgetsImprovements.
    const spentOf = budgetSpending(txns)
    const histMap: Record<string, { budget: number; spent: number }> = {}
    for (const b of budgets) {
      const mo = (b.start_date as string).slice(0, 7)
      if (!histMap[mo]) histMap[mo] = { budget: 0, spent: 0 }
      histMap[mo].budget += (b.amount as number) || 0
      histMap[mo].spent += spentOf(b)
    }

    const historyMonths = Object.keys(histMap)
      .filter((mo) => mo <= localMonth(now))
      .sort()
      .reverse()
      .slice(0, 6)

    const history = historyMonths.map((mo) => {
      const d = histMap[mo]
      return {
        month: mo,
        label: monthLabel(mo),
        total_budget: d.budget,
        total_spent: d.spent,
        adherence: d.budget > 0 ? Math.min(100, (d.spent / d.budget) * 100) : 0,
      }
    })

    const avgAdherence =
      history.length > 0
        ? history.reduce(
            (sum: number, h: Record<string, unknown>) => sum + (h.adherence as number),
            0
          ) / history.length
        : 0

    return json({
      period: month,
      history,
      forecast: forecastData,
      total_budget: budgets.reduce(
        (sum: number, b: Record<string, unknown>) => sum + ((b.amount as number) || 0),
        0
      ),
      avg_adherence: Math.round(avgAdherence),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
