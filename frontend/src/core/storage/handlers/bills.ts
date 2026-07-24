/**
 * Bills handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, notFound, ok } from './helpers'

// Helper: determine if a bill is paid for the current billing period (mirrors backend logic)
function isBillPaidForCurrentPeriod(bill: Record<string, unknown>, now: Date): boolean {
  if (!bill.last_paid_date && !bill.last_paid) return false
  const lastPaid = new Date((bill.last_paid_date || bill.last_paid) as string)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const frequency = (bill.frequency as string) || 'monthly'
  if (frequency === 'monthly') {
    return (
      lastPaid.getMonth() === today.getMonth() && lastPaid.getFullYear() === today.getFullYear()
    )
  } else if (frequency === 'weekly') {
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)
    return lastPaid >= weekAgo
  } else if (frequency === 'biweekly') {
    const twoWeeksAgo = new Date(today)
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    return lastPaid >= twoWeeksAgo
  } else if (frequency === 'yearly') {
    return lastPaid.getFullYear() === today.getFullYear()
  }
  return false
}

export async function billsList(query?: URLSearchParams): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('bills', 'by_profile', pid)
      all.push(...rows)
    }

    const now = new Date()
    const billsWithStatus: Record<string, unknown>[] = all.map((b) => ({
      ...b,
      autopay: b.autopay === 1 || b.autopay === true,
      paid: isBillPaidForCurrentPeriod(b, now),
    }))

    // Filter by paid status if requested
    let result = billsWithStatus
    const paidParam = query?.get('paid')
    if (paidParam === 'true') result = result.filter((b) => b.paid as boolean)
    if (paidParam === 'false') result = result.filter((b) => !(b.paid as boolean))

    // Filter by type if requested
    const typeParam = query?.get('type')
    if (typeParam) result = result.filter((b) => ((b.type as string) || 'bill') === typeParam)

    return json(result)
  } catch {
    return json([])
  }
}

/**
 * GET /api/bills/calendar?year=&month= — mirror of the worker route of the same path.
 * The Bills Calendar tab 404'd in serverless/demo mode because only the worker served it.
 */
export async function billsCalendar(query?: URLSearchParams): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  const now = new Date()

  const yearParam = parseInt(query?.get('year') || String(now.getFullYear()), 10)
  const monthParam = parseInt(query?.get('month') || String(now.getMonth() + 1), 10)
  if (isNaN(yearParam) || yearParam < 1900) return json({ error: 'Invalid year' }, 400)
  if (isNaN(monthParam) || monthParam < 1 || monthParam > 12) {
    return json({ error: 'Invalid month' }, 400)
  }

  const year = yearParam
  const month = monthParam
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  })
  const firstDow = new Date(year, month - 1, 1).getDay()
  const lastDay = new Date(year, month, 0).getDate()

  const days: Record<string, unknown[]> = {}
  for (let d = 1; d <= lastDay; d++) days[String(d)] = []

  const bills: Record<string, unknown>[] = []
  for (const pid of pids) {
    const rows = await db.getAllFromIndex('bills', 'by_profile', pid)
    bills.push(...rows.filter((b) => b.is_active !== 0))
  }

  let totalAmount = 0
  let paidAmount = 0
  let billCount = 0

  for (const b of bills) {
    // Occurrence day in the given month: due_date's day-of-month, else day_of_month field.
    let day = 1
    if (b.due_date) {
      const parsed = new Date(b.due_date as string)
      if (!isNaN(parsed.getTime())) day = parsed.getDate()
    } else if (b.day_of_month) {
      day = Number(b.day_of_month) || 1
    }
    if (day < 1 || day > lastDay) continue

    const billDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const isPaid = isBillPaidForCurrentPeriod(b, now)
    const daysUntil = Math.ceil((new Date(billDateStr).getTime() - now.getTime()) / 86_400_000)
    const amount = Number(b.amount) || 0

    days[String(day)]!.push({
      id: b.id,
      name: b.name,
      amount,
      frequency: b.frequency,
      category_id: b.category_id ?? null,
      category_name: (b.category_name as string) ?? null,
      category_color: (b.category_color as string) ?? null,
      date: billDateStr,
      paid: isPaid,
      type: (b.type as string) || 'bill',
      is_overdue: daysUntil < 0 && !isPaid,
    })

    totalAmount += amount
    if (isPaid) paidAmount += amount
    billCount++
  }

  return json({
    year,
    month,
    monthLabel,
    firstDow,
    days,
    summary: { totalAmount, paidAmount, billCount },
  })
}

export async function billsCreate(body: unknown): Promise<Response> {
  try {
    if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
    const b = body as Record<string, unknown>
    const name = ((b.name as string) || '').trim()
    const amount = parseFloat(String((b.amount as string | number) || 0))
    if (!name || isNaN(amount) || amount <= 0) {
      return json({ error: 'Name and a valid amount are required' }, 400)
    }
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const record = {
      profile_id: pid,
      name,
      amount,
      frequency: (b.frequency as string) || 'monthly',
      // The Bills form (and the worker API) send camelCase `dueDate`; internal callers use snake.
      due_date: ((b.due_date ?? b.dueDate) as string) || '',
      day_of_month: (b.day_of_month as number) || 1,
      category_id:
        b.category_id !== null && b.category_id !== undefined ? Number(b.category_id) : null,
      recurring: b.recurring !== false ? 1 : 0,
      autopay: b.autopay ? 1 : 0,
      is_active: 1,
      notes: (b.notes as string) || '',
      type: (b.type as string) || 'bill',
      created_at: new Date().toISOString(),
    }
    const id = await db.add('bills', record)
    return json({ id }, 201)
  } catch (err) {
    return json({ error: `Failed to create bill: ${(err as Error).message}` }, 500)
  }
}

export async function billsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const b = await db.get('bills', idParam(params))
  return b ? json({ ...b, autopay: b.autopay === 1 || b.autopay === true }) : notFound('Bill')
}

export async function billsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const bill = await db.get('bills', idParam(params))
  if (!bill) return notFound('Bill')
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.name !== undefined) bill.name = b.name
    if (b.amount !== undefined) bill.amount = parseFloat(String((b.amount as string | number) || 0))
    if (b.frequency !== undefined) bill.frequency = b.frequency
    if (b.due_date !== undefined || b.dueDate !== undefined) bill.due_date = b.due_date ?? b.dueDate
    if (b.day_of_month !== undefined) bill.day_of_month = Number(b.day_of_month)
    if (b.category_id !== undefined)
      bill.category_id = b.category_id !== null ? Number(b.category_id) : null
    if (b.recurring !== undefined) bill.recurring = b.recurring ? 1 : 0
    if (b.autopay !== undefined) bill.autopay = b.autopay ? 1 : 0
    if (b.is_active !== undefined) bill.is_active = b.is_active ? 1 : 0
    if (b.notes !== undefined) bill.notes = b.notes
    if (b.type !== undefined) bill.type = b.type
  }
  await db.put('bills', bill)
  return ok()
}

export async function billsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  await db.delete('bills', idParam(params))
  return ok()
}

export async function billsUpcoming(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('bills', 'by_profile', pid)
      all.push(...rows)
    }
    const active = all.filter((b: Record<string, unknown>) => b.is_active !== 0)
    const today = new Date()
    const dayOfMonth = today.getDate()
    const upcoming = active
      .filter((b: Record<string, unknown>) => {
        // Derive day of month from due_date (format: YYYY-MM-DD) or fall back to day_of_month field
        const dueDate = (b.due_date as string) || ''
        const dom = dueDate ? parseInt(dueDate.split('-')[2], 10) : Number(b.day_of_month) || 1
        return dom >= dayOfMonth
      })
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        const aDate = (a.due_date as string) || ''
        const bDate = (b.due_date as string) || ''
        const aDom = aDate ? parseInt(aDate.split('-')[2], 10) : Number(a.day_of_month) || 1
        const bDom = bDate ? parseInt(bDate.split('-')[2], 10) : Number(b.day_of_month) || 1
        return aDom - bDom
      })
    return json(upcoming)
  } catch {
    return json([])
  }
}

export async function billsPayOrMarkPaid(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const bill = await db.get('bills', idParam(params))
  if (!bill) return notFound('Bill')
  const now = new Date().toISOString().substring(0, 10)
  bill.last_paid_date = now
  bill.last_paid = now
  await db.put('bills', bill)
  return ok()
}
