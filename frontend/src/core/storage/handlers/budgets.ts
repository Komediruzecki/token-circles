/**
 * Budget handlers — IndexedDB-backed implementations for all /api/budgets routes.
 */
import { getDB } from '../idb'
import { adapter, endOfNextMonth, getAmount, idParam, json, monthStart, nextMonth, notFound, ok, prevMonth } from './helpers'

export async function budgetsList(): Promise<Response> {
  const budgets = await adapter.listBudgets()
  return json(budgets)
}

export async function budgetsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid budget data' }, 400)
  const budget = body as Record<string, unknown>
  budget.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createBudget(
    budget as unknown as Parameters<typeof adapter.createBudget>[0]
  )
  return json({ id, ...budget }, 201)
}

export async function budgetsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const budget = await db.get('budgets', idParam(params))
  if (!budget) return notFound('Budget')
  return json(budget)
}

export async function budgetsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateBudget(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function budgetsDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteBudget(idParam(params))
  return ok()
}

// ── Budget alerts ────────────────────────────────────────────────────────────

export async function budgetsAlerts(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
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

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) => !b.end_date || (b.end_date as string) >= startDate
    )

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
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

    const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
    const catMap: Record<number, Record<string, unknown>> = {}
    for (const c of cats) catMap[c.id as number] = c

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
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const categoryId = parseInt(query.get('category_id')!)
    const months = parseInt(query.get('months')!) || 6

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid))
      .filter((b: Record<string, unknown>) => b.category_id === categoryId)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (b.start_date as string).localeCompare(a.start_date as string)
      )

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) => t.type === 'expense' && t.category_id === categoryId
    )

    const history = budgets.slice(0, months).map((b: Record<string, unknown>) => {
      const start = b.start_date as string
      const end = endOfNextMonth(start)
      const spent = txns
        .filter(
          (t: Record<string, unknown>) => (t.date as string) >= start && (t.date as string) < end
        )
        .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)
      return { month: start, budget_amount: b.amount, spent }
    })

    return json(history)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget improvements ──────────────────────────────────────────────────────

export async function budgetsImprovements(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const numMonths = parseInt(query.get('months')!) || 6

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)) as Record<
      string,
      unknown
    >[]
    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Record<
      string,
      unknown
    >[]

    const monthlyMap: Record<string, { budget: number; spent: number }> = {}
    for (const b of budgets) {
      const mo = (b.start_date as string).slice(0, 7)
      if (!monthlyMap[mo]) monthlyMap[mo] = { budget: 0, spent: 0 }
      monthlyMap[mo].budget += (b.amount as number) || 0
    }
    for (const t of txns) {
      if (t.type !== 'expense') continue
      const mo = (t.date as string).slice(0, 7)
      if (monthlyMap[mo]) {
        monthlyMap[mo].spent += getAmount(t)
      }
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
      const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
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
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const now = new Date()
    const y = parseInt(query.get('year')!) || now.getFullYear()
    const m = parseInt(query.get('month')!) || now.getMonth() + 1

    const startDate = monthStart(y, m)
    const nm = nextMonth(y, m)
    const endDate = monthStart(nm.year, nm.month)

    const pm = prevMonth(y, m)
    const prevStart = monthStart(pm.year, pm.month)

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) => !b.end_date || (b.end_date as string) >= startDate
    )

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        t.category_id !== null &&
        (t.date as string) >= startDate &&
        (t.date as string) < endDate
    )

    const prevTxns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
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

    const prevBudgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
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

    const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
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
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const month = query.get('month') || new Date().toISOString().slice(0, 7)
    const startOfMonth = `${month}-01`
    const endOfMonth = endOfNextMonth(startOfMonth)

    const cats = (await db.getAllFromIndex('categories', 'by_profile', pid))
      .filter((c: Record<string, unknown>) => c.type === 'expense')
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        (a.name as string).localeCompare(b.name as string)
      )

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= startOfMonth &&
        (b.start_date as string) < endOfMonth &&
        b.period === 'monthly'
    )

    const budgetMap: Record<number, Record<string, unknown>> = {}
    for (const b of budgets) budgetMap[b.category_id as number] = b

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

    let alreadyBudgeted = 0
    for (const b of budgets) alreadyBudgeted += (b.amount as number) || 0
    const unassignedBudget = Math.max(0, income - alreadyBudgeted)

    const allocations = cats.map((cat: Record<string, unknown>) => {
      const budget = budgetMap[cat.id as number]
      const spentAmt = spentMap[cat.id as number] || 0
      const budgetAmount = (budget?.amount as number) || 0
      const effectiveAmount = budgetAmount > 0 ? budgetAmount : spentAmt
      const remainingBudget = effectiveAmount - spentAmt
      const percentUsed = effectiveAmount > 0 ? (spentAmt / effectiveAmount) * 100 : 0

      return {
        budget_id: budget?.id ?? null,
        category_id: cat.id,
        category_name: cat.name,
        category_color: cat.color,
        category_icon: cat.icon,
        amount: effectiveAmount,
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
    const month = query.get('month') || new Date().toISOString().slice(0, 7)
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

    for (const item of summary) {
      if (item.percent_used >= 90) {
        item.alerts.push(`Approaching limit: ${Math.round(item.percent_used)}% used`)
      }
      if (item.percent_used >= 100) {
        item.alerts.push(`Over budget by $${Math.abs(item.remaining).toFixed(2)}`)
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
    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const { category_id, amount, period } = body as Record<string, unknown>
    if (!category_id || amount === null) {
      return json({ error: 'Category ID and amount are required' }, 400)
    }

    const month = query.get('month') || new Date().toISOString().slice(0, 7)
    const start_date = `${month}-01`
    const budgetPeriod = (period as string) || 'monthly'

    const db = await getDB()
    const existing = (await db.getAllFromIndex('budgets', 'by_profile', pid)).find(
      (b: Record<string, unknown>) =>
        b.category_id === category_id && b.start_date === start_date && b.period === budgetPeriod
    )

    if (existing) {
      return json(
        {
          error: `Budget already exists for ${month}. Use PUT /api/budgets/${existing.id} to update it.`,
        },
        400
      )
    }

    const id = await adapter.createBudget({
      category_id: category_id as number,
      amount: amount as number,
      period: budgetPeriod as 'monthly' | 'weekly' | 'yearly',
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

    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const { rollover_amount, rollover_used, rollover_enabled } = body as Record<string, unknown>

    if (
      rollover_amount === undefined &&
      rollover_used === undefined &&
      rollover_enabled === undefined
    ) {
      return json({ error: 'No rollover fields provided' }, 400)
    }

    const budget = await db.get('budgets', id)
    if (!budget || (budget.profile_id as number) !== pid) {
      return json({ error: 'Budget not found' }, 404)
    }

    if (rollover_amount !== undefined) budget.rollover_amount = rollover_amount as number
    if (rollover_used !== undefined) budget.rollover_used = rollover_used as number
    if (rollover_enabled !== undefined) budget.rollover_enabled = rollover_enabled ? true : false

    await db.put('budgets', budget)

    return json({ ok: true, budget })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget from-expenses ─────────────────────────────────────────────────────

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
    const prevEnd = monthStart(targetYear, targetMonth)

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t: Record<string, unknown>) =>
        t.type === 'expense' &&
        t.category_id !== null &&
        (t.date as string) >= prevStart &&
        (t.date as string) < prevEnd
    )

    const expensesByCat: Record<number, number> = {}
    for (const t of txns) {
      const cid = t.category_id as number
      expensesByCat[cid] = (expensesByCat[cid] || 0) + getAmount(t)
    }

    const entries = Object.entries(expensesByCat)
    if (entries.length === 0) {
      return json({ ok: false, message: 'No expenses found for previous month' })
    }

    const currStart = monthStart(targetYear, targetMonth)
    const currEnd =
      targetMonth === 12 ? monthStart(targetYear + 1, 1) : monthStart(targetYear, targetMonth + 1)

    const existingBudgets = (await db.getAllFromIndex('budgets', 'by_profile', pid)).filter(
      (b: Record<string, unknown>) =>
        (b.start_date as string) >= currStart && (b.start_date as string) < currEnd
    )

    const tx = db.transaction('budgets', 'readwrite')
    for (const b of existingBudgets) await tx.store.delete(b.id as number)

    for (const [catId, total] of entries) {
      await tx.store.add({
        category_id: parseInt(catId),
        amount: total,
        period: 'monthly',
        start_date: currStart,
        profile_id: pid,
        rollover_enabled: false,
        rollover_amount: 0,
      })
    }
    await tx.done

    return json({ ok: true, count: entries.length })
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

    const tx = db.transaction('budgets', 'readwrite')
    for (const b of existingBudgets) await tx.store.delete(b.id as number)

    for (const b of prevBudgets) {
      await tx.store.add({
        category_id: b.category_id,
        amount: b.amount,
        period: b.period,
        start_date: currStart,
        profile_id: pid,
        rollover_enabled: (b as Record<string, unknown>).rollover_enabled || false,
        rollover_amount: (b as Record<string, unknown>).rollover_amount || 0,
      })
    }
    await tx.done

    return json({ ok: true, count: prevBudgets.length })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

// ── Budget forecast ──────────────────────────────────────────────────────────

export async function budgetsForecast(query: URLSearchParams): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const month = query.get('month') || new Date().toISOString().slice(0, 7)

    const budgets = (await db.getAllFromIndex('budgets', 'by_profile', pid))
      .filter((b: Record<string, unknown>) => (b.start_date as string) <= month)
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

    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Record<
      string,
      unknown
    >[]

    const catAvgs: Record<number, { total: number; count: number; avgAmount: number }> = {}
    for (const b of budgets) {
      const cid = b.category_id as number
      if (!catAvgs[cid]) catAvgs[cid] = { total: 0, count: 0, avgAmount: 0 }

      const bStart = b.start_date as string
      const bEnd = endOfNextMonth(bStart)
      const spent = txns
        .filter(
          (t: Record<string, unknown>) =>
            t.type === 'expense' &&
            t.category_id === cid &&
            (t.date as string) >= bStart &&
            (t.date as string) < bEnd
        )
        .reduce((sum: number, t: Record<string, unknown>) => sum + getAmount(t), 0)
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
        month: date.toISOString().slice(0, 7),
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

    const histMap: Record<string, { budget: number; spent: number }> = {}
    for (const b of budgets) {
      const mo = (b.start_date as string).slice(0, 7)
      if (!histMap[mo]) histMap[mo] = { budget: 0, spent: 0 }
      histMap[mo].budget += (b.amount as number) || 0
    }
    for (const t of txns) {
      if (t.type !== 'expense') continue
      const mo = (t.date as string).slice(0, 7)
      if (histMap[mo]) histMap[mo].spent += getAmount(t)
    }

    const historyMonths = Object.keys(histMap)
      .filter((mo) => mo <= now.toISOString().slice(0, 7))
      .sort()
      .reverse()
      .slice(0, 6)

    const history = historyMonths.map((mo) => {
      const d = histMap[mo]
      return {
        month: mo,
        label: new Date(`${mo}-01`).toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        }),
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
