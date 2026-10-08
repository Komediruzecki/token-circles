/**
 * Bills handlers — IndexedDB-backed implementations
 */
import {
  billDay,
  comingUp,
  daysFrom,
  dueWithin,
  isPaidUp,
  nextDueDate,
} from '../../../../../shared/billSchedule'
import { BILL_MESSAGES, checkBillCreate, checkBillEdit } from '../../../../../shared/billSchema'
import { isoDate, localToday } from '../../../utils/period'
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

/**
 * A stored bill as the schedule reads it (shared/billSchedule.ts, the Worker's rule too). A payment
 * an older version of this app recorded may carry only `last_paid`; this one writes both.
 */
function timing(bill: Record<string, unknown>): Record<string, unknown> {
  return { ...bill, last_paid_date: bill.last_paid_date ?? bill.last_paid ?? null }
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

    // Whether it is paid, and when it falls due next, by the Worker's rule: the stored
    // next_due_date is never written, and the due date a bill was saved with is only its first.
    const today = localToday()
    const looks = await categoryLooks(pids)
    const billsWithStatus: Record<string, unknown>[] = all.map((b) => ({
      ...normalizeBill(b),
      category_name: looks.get(b.category_id as number)?.name ?? null,
      category_color: looks.get(b.category_id as number)?.color ?? null,
      autopay: b.autopay === 1 || b.autopay === true,
      next_due_date: nextDueDate(timing(b), today),
      paid: isPaidUp(timing(b), today),
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
  const today = localToday(now)

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
    // The bill's day of the month (shared/billSchedule.ts: its due date's), and a day the month does
    // not have falls on its last day, as shared/calendarMonths.ts moves a monthly date: a bill due on
    // the 31st was not drawn at all in February, April or June.
    const day = Math.min(billDay(b), lastDay)
    const billDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const isPaid = isPaidUp(timing(b), today)
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
      is_overdue: daysFrom(today, billDateStr) < 0 && !isPaid,
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
  // The account first, then the category, as the Worker checks them: a bill on another profile's
  // account and category is refused at the same field in both runtimes.
  if (!(await currentProfileOwns('accounts', bill.account_id))) {
    return refuse({ account_id: BILL_MESSAGES.account })
  }
  if (!(await currentProfileOwns('categories', bill.category_id))) {
    return refuse({ category_id: BILL_MESSAGES.category })
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
  // The account first, then the category, as the Worker checks them.
  if (edit.account_id !== undefined && !(await currentProfileOwns('accounts', edit.account_id))) {
    return refuse({ account_id: BILL_MESSAGES.account })
  }
  if (
    edit.category_id !== undefined &&
    !(await currentProfileOwns('categories', edit.category_id))
  ) {
    return refuse({ category_id: BILL_MESSAGES.category })
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

/**
 * GET /api/bills/upcoming, as the Worker answers it: every active bill with when it falls due next
 * (shared/billSchedule.ts), the most overdue first. It answered the stored rows whose due day of
 * the month was today or later, with no date.
 */
export async function billsUpcoming(): Promise<Response> {
  const db = await getDB()
  const all: Record<string, unknown>[] = []
  const categories = new Map<unknown, Record<string, unknown>>()
  for (const pid of adapter.getCurrentProfileIds()) {
    all.push(...(await db.getAllFromIndex('bills', 'by_profile', pid)))
    for (const category of await db.getAllFromIndex('categories', 'by_profile', pid)) {
      categories.set(category.id, category as Record<string, unknown>)
    }
  }
  return json(
    comingUp(all.map(timing), localToday()).map((b) => {
      const category = categories.get(b.category_id)
      return {
        id: b.id,
        name: b.name,
        amount: b.amount,
        frequency: b.frequency,
        day_of_month: b.day_of_month ?? null,
        category_name: category?.name ?? null,
        category_color: category?.color ?? null,
        category_id: b.category_id ?? null,
        last_paid: b.last_paid_date,
        last_paid_date: b.last_paid_date,
        next_due_date: b.next_due_date,
        days_until: b.days_until,
        is_overdue: b.is_overdue,
        paid: b.paid,
      }
    })
  )
}

/**
 * The Dashboard's Upcoming Bills, as GET /api/dashboard answers them on the Worker: the active bills
 * of the selected profiles that fall due from today through the next 30 days (shared/billSchedule.ts),
 * soonest first, five at most. Local-first answered none, so the card showed in cloud mode only.
 */
export async function dashboardUpcomingBills(): Promise<Record<string, unknown>[]> {
  const db = await getDB()
  const profiles = new Map((await db.getAll('profiles')).map((p) => [p.id, p.name]))
  const all: Record<string, unknown>[] = []
  for (const pid of adapter.getCurrentProfileIds()) {
    all.push(...(await db.getAllFromIndex('bills', 'by_profile', pid)))
  }
  return dueWithin(all.map(timing), localToday(), 30)
    .slice(0, 5)
    .map((b) => ({
      ...normalizeBill(b),
      profile_name: profiles.get(b.profile_id as number) ?? null,
    }))
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
    (bill) => isPaidUp(timing(bill), isoDate(now))
  )
  if (result === 'missing') return notFound('Bill')
  if (result === 'already-paid') {
    return json({ error: 'Bill already paid for current period' }, 409)
  }
  return json({ ok: true, transactionId: result.transactionId })
}
