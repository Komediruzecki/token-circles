import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId, getProfileIds } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of backend/routes/bills.js + backend/repositories/billsRepo.js.
// Table: bills, LEFT JOINed to categories for name/color. Response shapes are
// kept identical (snake_case) to the Express backend.
export const billsRoutes = new Hono<AppEnv>()

interface BillRow {
  id: number
  name: string
  amount: number
  frequency: string
  day_of_month: number | null
  category_id: number | null
  due_date: string | null
  is_active: number
  last_paid: string | null
  last_paid_date: string | null
  notes: string | null
  type: string | null
  category_name?: string | null
  category_color?: string | null
}

// Copied faithfully from backend/routes/bills.js.
function isBillPaidForCurrentPeriod(bill: BillRow, now: Date): boolean {
  if (!bill.last_paid_date) return false
  const lastPaid = new Date(bill.last_paid_date)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  if (bill.frequency === 'monthly') {
    // Paid if last_paid is in the current month
    return lastPaid.getMonth() === today.getMonth() && lastPaid.getFullYear() === today.getFullYear()
  } else if (bill.frequency === 'weekly') {
    // Paid if last_paid is within the last 7 days
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)
    return lastPaid >= weekAgo
  } else if (bill.frequency === 'biweekly') {
    // Paid if last_paid is within the last 14 days
    const twoWeeksAgo = new Date(today)
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    return lastPaid >= twoWeeksAgo
  } else if (bill.frequency === 'yearly') {
    // Paid if last_paid is in the current year
    return lastPaid.getFullYear() === today.getFullYear()
  }
  return false
}

billsRoutes.get('/api/bills', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const rows = await db.all<BillRow>(
    c.env.DB,
    `
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.profile_id = ?
      ORDER BY b.is_active DESC, b.name ASC
    `,
    pid
  )

  const now = new Date()

  const billsWithStatus = rows.map((b) => ({ ...b, paid: isBillPaidForCurrentPeriod(b, now) }))

  // Filter by paid status if requested
  let result = billsWithStatus
  const paidQ = c.req.query('paid')
  if (paidQ === 'true') {
    result = result.filter((b) => b.paid)
  } else if (paidQ === 'false') {
    result = result.filter((b) => !b.paid)
  }

  // Filter by type if requested (bill, subscription)
  const typeQ = c.req.query('type')
  if (typeQ) {
    result = result.filter((b) => (b.type || 'bill') === typeQ)
  }

  return c.json(result)
})

// Registered before /api/bills/:id so it isn't shadowed.
billsRoutes.get('/api/bills/upcoming', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]

  const bills = await db.all<BillRow>(
    c.env.DB,
    `
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.profile_id = ? AND b.is_active = 1
      ORDER BY b.name ASC
    `,
    pid
  )

  const upcoming = bills.map((b) => {
    let nextDue: Date | null = null
    const lastPaid = b.last_paid ? new Date(b.last_paid) : null

    if (b.frequency === 'monthly') {
      const dayOfMonth = b.day_of_month || 1
      if (lastPaid) {
        nextDue = new Date(lastPaid)
        nextDue.setMonth(nextDue.getMonth() + 1)
        nextDue.setDate(Math.min(dayOfMonth, new Date(nextDue.getFullYear(), nextDue.getMonth() + 1, 0).getDate()))
      } else {
        nextDue = new Date(
          now.getFullYear(),
          now.getMonth(),
          Math.min(dayOfMonth, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())
        )
        if (nextDue < now) nextDue.setMonth(nextDue.getMonth() + 1)
      }
    } else if (b.frequency === 'weekly') {
      if (lastPaid) {
        nextDue = new Date(lastPaid)
        nextDue.setDate(nextDue.getDate() + 7)
      } else {
        nextDue = new Date(todayStr)
        nextDue.setDate(nextDue.getDate() + 7)
      }
    } else if (b.frequency === 'yearly') {
      if (lastPaid) {
        nextDue = new Date(lastPaid)
        nextDue.setFullYear(nextDue.getFullYear() + 1)
      } else {
        const dayOfMonth = b.day_of_month || 1
        nextDue = new Date(now.getFullYear(), 0, dayOfMonth)
        if (nextDue < now) nextDue.setFullYear(nextDue.getFullYear() + 1)
      }
    }

    const nextDueStr = nextDue ? nextDue.toISOString().split('T')[0] : null
    const daysUntil = nextDue ? Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null
    const isOverdue = daysUntil !== null && daysUntil < 0

    return {
      id: b.id,
      name: b.name,
      amount: b.amount,
      frequency: b.frequency,
      day_of_month: b.day_of_month,
      category_name: b.category_name,
      category_color: b.category_color,
      category_id: b.category_id,
      last_paid: b.last_paid,
      next_due_date: nextDueStr,
      days_until: daysUntil,
      is_overdue: isOverdue,
      paid: isBillPaidForCurrentPeriod(b, now),
    }
  })

  upcoming.sort((a, b) => {
    if (a.is_overdue && !b.is_overdue) return -1
    if (!a.is_overdue && b.is_overdue) return 1
    if (a.days_until !== null && b.days_until !== null) return a.days_until - b.days_until
    if (a.days_until !== null) return -1
    if (b.days_until !== null) return 1
    return 0
  })

  return c.json(upcoming)
})

billsRoutes.get('/api/bills/summary', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const bills = await db.all<BillRow>(c.env.DB, 'SELECT * FROM bills WHERE profile_id = ?', pid)
  const totalAmount = bills.reduce((s, b) => s + (b.amount || 0), 0)
  return c.json({ totalAmount, activeCount: bills.length, bills })
})

billsRoutes.get('/api/bills/notifications', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const bills = await db.all<BillRow>(c.env.DB, 'SELECT * FROM bills WHERE profile_id = ? ORDER BY due_date ASC', pid)
  const today = new Date()
  const upcoming = bills.filter((b) => {
    if (!b.due_date) return false
    const dueDate = new Date(b.due_date)
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return diffDays >= 0 && diffDays <= 7
  })
  return c.json({ notifications: upcoming, count: upcoming.length })
})

billsRoutes.get('/api/bills/calendar', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const now = new Date()

  const yearQ = c.req.query('year')
  const monthQ = c.req.query('month')
  const yearParam = yearQ ? parseInt(yearQ, 10) : now.getFullYear()
  const monthParam = monthQ ? parseInt(monthQ, 10) : now.getMonth() + 1

  if (isNaN(yearParam) || yearParam < 1900) throw new HttpError(400, 'Invalid year')
  if (isNaN(monthParam) || monthParam < 1 || monthParam > 12) throw new HttpError(400, 'Invalid month')

  const year = yearParam
  const month = monthParam
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
  const firstDow = new Date(year, month - 1, 1).getDay()
  const lastDay = new Date(year, month, 0).getDate()

  const days: Record<string, unknown[]> = {}
  for (let d = 1; d <= lastDay; d++) {
    days[String(d)] = []
  }

  const bills = await db.all<BillRow>(
    c.env.DB,
    `SELECT b.*, c.name as category_name, c.color as category_color
       FROM bills b
       LEFT JOIN categories c ON b.category_id = c.id
       WHERE b.profile_id = ? AND b.is_active = 1`,
    pid
  )

  let totalAmount = 0
  let paidAmount = 0
  let billCount = 0

  bills.forEach((b) => {
    // Determine occurrence in the given month. For simplicity we use due_date's day or day_of_month
    let day: number
    let billDateStr: string

    if (b.due_date) {
      const dDate = new Date(b.due_date)
      day = dDate.getDate()
      billDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    } else if (b.day_of_month) {
      day = b.day_of_month
      billDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    } else {
      day = 1 // Fallback
      billDateStr = `${year}-${String(month).padStart(2, '0')}-01`
    }

    if (day >= 1 && day <= lastDay) {
      const isPaid = isBillPaidForCurrentPeriod(b, now)

      // Calculate is_overdue for the specific bill occurrence in this month
      const nextDue = new Date(billDateStr)
      const daysUntil = Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      const is_overdue = daysUntil < 0 && !isPaid

      days[String(day)]!.push({
        id: b.id,
        name: b.name,
        amount: b.amount,
        frequency: b.frequency,
        category_id: b.category_id,
        category_name: b.category_name,
        category_color: b.category_color,
        date: billDateStr,
        paid: isPaid,
        type: b.type || 'bill',
        is_overdue,
      })

      totalAmount += b.amount
      if (isPaid) paidAmount += b.amount
      billCount++
    }
  })

  return c.json({
    year,
    month,
    monthLabel,
    firstDow,
    days,
    summary: {
      totalAmount,
      paidAmount,
      billCount,
    },
  })
})

billsRoutes.post('/api/bills', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const b = (await c.req.json()) as Record<string, any>
  const { name, amount, frequency, day_of_month, category_id, notes, type, dueDate } = b
  if (!name || amount === undefined) throw new HttpError(400, 'Name and amount are required')
  if (!dueDate) throw new HttpError(400, 'Due date is required')
  if (isNaN(Date.parse(dueDate))) throw new HttpError(400, 'Invalid due date format')
  if (parseFloat(amount) <= 0) throw new HttpError(400, 'Amount must be positive')
  const res = await db.insert(c.env.DB, 'bills', {
    profile_id: pid,
    name,
    amount,
    frequency: frequency || 'monthly',
    day_of_month: day_of_month || null,
    category_id: category_id || null,
    notes: notes || '',
    type: type || 'bill',
    due_date: dueDate,
  })
  return c.json({ id: res.meta.last_row_id })
})

billsRoutes.put('/api/bills/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const existing = await db.first<BillRow>(c.env.DB, 'SELECT * FROM bills WHERE id = ? AND profile_id = ?', id, pid)
  if (!existing) throw new HttpError(404, 'Not found')
  const b = (await c.req.json()) as Record<string, any>
  const { name, amount, frequency, day_of_month, category_id, is_active, notes, type } = b
  await db.update(
    c.env.DB,
    'bills',
    {
      name: name ?? '',
      amount: amount ?? 0,
      frequency: frequency ?? 'monthly',
      day_of_month: day_of_month ?? null,
      category_id: category_id ?? null,
      is_active: is_active ?? 1,
      notes: notes ?? '',
      type: type ?? 'bill',
    },
    'id = ? AND profile_id = ?',
    id,
    pid
  )
  return c.json({ ok: true })
})

billsRoutes.delete('/api/bills/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  await db.del(c.env.DB, 'bills', 'id = ? AND profile_id = ?', c.req.param('id'), pid)
  return c.json({ ok: true })
})

billsRoutes.post('/api/bills/:id/mark-paid', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const bill = await db.first<BillRow>(c.env.DB, 'SELECT * FROM bills WHERE id = ? AND profile_id = ?', id, pid)
  if (!bill) throw new HttpError(404, 'Not found')

  const todayStr = new Date().toISOString().split('T')[0]
  const tx = await db.insert(c.env.DB, 'transactions', {
    profile_id: pid,
    description: bill.name,
    amount: bill.amount,
    type: 'expense',
    category_id: bill.category_id,
    date: todayStr,
    notes: bill.notes || '',
  })

  await db.update(c.env.DB, 'bills', { last_paid_date: todayStr }, 'id = ? AND profile_id = ?', id, pid)

  return c.json({ ok: true, transactionId: tx.meta.last_row_id })
})

// Registered after the specific /api/bills/* GET routes so it doesn't shadow them.
billsRoutes.get('/api/bills/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const bill = await db.first<BillRow>(c.env.DB, 'SELECT * FROM bills WHERE id = ? AND profile_id = ?', c.req.param('id'), pid)
  if (!bill) throw new HttpError(404, 'Bill not found')
  return c.json(bill)
})
