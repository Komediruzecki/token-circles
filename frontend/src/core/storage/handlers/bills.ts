/**
 * Bills handlers — IndexedDB-backed implementations
 */
import { BILL_MESSAGES, checkBillCreate, checkBillEdit } from '../../../../../shared/billSchema'
import { isoDate, parseLocalDate } from '../../../utils/period'
import { getLocalCurrency } from '../../api'
import { getDB } from '../idb'
import {
  adapter,
  currentProfileOwns,
  currentProfileRecord,
  idParam,
  json,
  notFound,
  ok,
  refuse,
} from './helpers'
import { normalizeBill } from './normalize'

// Helper: determine if a bill is paid for the current billing period (mirrors backend logic)
function isBillPaidForCurrentPeriod(bill: Record<string, unknown>, now: Date): boolean {
  if (!bill.last_paid_date && !bill.last_paid) return false
  // parseLocalDate, not `new Date(str)`: a bare `YYYY-MM-DD` parses as UTC midnight, whose local
  // month is the previous one west of UTC. Comparing that against a LOCAL `today` below reported
  // a bill unpaid the instant it was marked paid, every 1st of the month. The worker mirror gets
  // away with the same code only because its runtime is UTC; a browser's is the user's own zone.
  const lastPaid = parseLocalDate(bill.last_paid_date || bill.last_paid)
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

/**
 * The name and colour of each profile's categories, by id, for the bills that point at them: the
 * Worker joins them onto its bill rows, and the Bill Calendar and Housing show them.
 */
async function categoryLooks(
  pids: number[]
): Promise<Map<number, { name: unknown; color: unknown }>> {
  const db = await getDB()
  const looks = new Map<number, { name: unknown; color: unknown }>()
  for (const pid of pids) {
    for (const c of await db.getAllFromIndex('categories', 'by_profile', pid)) {
      looks.set(c.id as number, { name: c.name, color: c.color })
    }
  }
  return looks
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
    const looks = await categoryLooks(pids)
    const billsWithStatus: Record<string, unknown>[] = all.map((b) => ({
      ...normalizeBill(b),
      category_name: looks.get(b.category_id as number)?.name ?? null,
      category_color: looks.get(b.category_id as number)?.color ?? null,
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
  const looks = await categoryLooks(pids)

  for (const b of bills) {
    // Occurrence day in the given month: due_date's day-of-month, else day_of_month field.
    let day = 1
    if (b.due_date) {
      // Local parse, or the calendar shifts a day west of UTC: a bill due on the 15th would be
      // drawn on the 14th, and one due on the 1st would fall out of the month entirely.
      const parsed = parseLocalDate(b.due_date)
      if (!isNaN(parsed.getTime())) day = parsed.getDate()
    } else if (b.day_of_month) {
      day = Number(b.day_of_month) || 1
    }
    // A day the month does not have falls on its last day, as shared/calendarMonths.ts moves a
    // monthly date: a bill due on the 31st was not drawn at all in February, April or June.
    day = Math.min(day, lastDay)
    if (day < 1) continue

    const billDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const isPaid = isBillPaidForCurrentPeriod(b, now)
    // Both sides on the local calendar: mixing a UTC-parsed midnight with a local instant put
    // `daysUntil` off by one for part of every day.
    const daysUntil = Math.ceil(
      (parseLocalDate(billDateStr).getTime() - now.getTime()) / 86_400_000
    )
    const amount = Number(b.amount) || 0

    days[String(day)]!.push({
      id: b.id,
      name: b.name,
      amount,
      frequency: b.frequency,
      category_id: b.category_id ?? null,
      category_name: looks.get(b.category_id as number)?.name ?? null,
      category_color: looks.get(b.category_id as number)?.color ?? null,
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

// The rules and their words are shared/billSchema.ts, which the Worker and the Bills dialog run
// too. Only the checked fields are stored. A bill without a day of the month stores none, as on the
// Worker: it stored 1, so the same bill fell due on different days (`day-of-month-default`).
export async function billsCreate(body: unknown): Promise<Response> {
  const checked = checkBillCreate(body)
  if (!checked.ok) return refuse(checked.fields)
  const bill = checked.value
  if (!(await currentProfileOwns('categories', bill.category_id))) {
    return refuse({ category_id: BILL_MESSAGES.category })
  }
  if (!(await currentProfileOwns('accounts', bill.account_id))) {
    return refuse({ account_id: BILL_MESSAGES.account })
  }
  const record = {
    profile_id: await adapter.getCurrentProfileId(),
    ...bill,
    autopay: bill.autopay ? 1 : 0,
    // The Worker's column defaults; BillSchema requires each key.
    last_paid_date: null,
    next_due_date: null,
    recurring: 1,
    is_active: 1,
    created_at: new Date().toISOString(),
  }
  const id = await (await getDB()).add('bills', record)
  return json({ id }, 201)
}

export async function billsGet(params: Record<string, string>): Promise<Response> {
  const b = await currentProfileRecord('bills', idParam(params))
  return b
    ? json({ ...normalizeBill(b), autopay: b.autopay === 1 || b.autopay === true })
    : notFound('Bill')
}

export async function billsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const bill = await currentProfileRecord('bills', idParam(params))
  if (!bill) return notFound('Bill')
  // Only the fields whose value the edit changes are checked and written (decision 2).
  const checked = checkBillEdit(body, bill)
  if (!checked.ok) {
    console.error('[billsUpdate] Validation failed', { id: bill.id, body, fields: checked.fields })
    return refuse(checked.fields)
  }
  const edit = checked.value
  if (
    edit.category_id !== undefined &&
    !(await currentProfileOwns('categories', edit.category_id))
  ) {
    return refuse({ category_id: BILL_MESSAGES.category })
  }
  if (edit.account_id !== undefined && !(await currentProfileOwns('accounts', edit.account_id))) {
    return refuse({ account_id: BILL_MESSAGES.account })
  }
  const row: Record<string, unknown> = { ...bill, ...edit }
  if (edit.autopay !== undefined) row.autopay = edit.autopay ? 1 : 0
  if (edit.is_active !== undefined) row.is_active = edit.is_active ? 1 : 0
  await db.put('bills', row)
  return ok()
}

export async function billsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const id = idParam(params)
  if (!(await currentProfileRecord('bills', id))) return notFound('Bill')
  await db.delete('bills', id)
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

/**
 * Pay a bill, as the Worker's mark-paid does: refused when it is already paid for its current
 * period, and otherwise an expense transaction for its amount, dated today in the base currency,
 * that moves its account's balance, with the bill stamped paid. Marking paid used to stamp the
 * bill and nothing else here, so in local-first mode a paid bill never reached the transactions,
 * the account balance, or anything counted from them.
 */
export async function billsPayOrMarkPaid(params: Record<string, string>): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  // A paid date is a wall-clock date, so it must be the user's date. toISOString() gave the UTC
  // one, which east of UTC is still yesterday for the first hours of every local day — so a bill
  // paid at 01:00 on the 1st was stamped with last month and read back as unpaid.
  const now = new Date()
  const result = await adapter.payBill(
    idParam(params),
    pid,
    { date: isoDate(now), currency: getLocalCurrency(), createdAt: now.toISOString() },
    (bill) => isBillPaidForCurrentPeriod(bill, now)
  )
  if (result === 'missing') return notFound('Bill')
  if (result === 'already-paid') {
    return json({ error: 'Bill already paid for current period' }, 409)
  }
  return json({ ok: true, transactionId: result.transactionId })
}
