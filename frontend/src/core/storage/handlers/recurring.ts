/**
 * Recurring handlers — IndexedDB-backed implementations
 */
import { nextOccurrence } from '../../../../../shared/calendarMonths'
import { transactionInvariantError } from '../../../../../shared/transactionInvariant'
import { localToday } from '../../../utils/period'
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
} from './helpers'

/**
 * The active profile's rules, as the Worker lists them. This used to read every ticked profile
 * (Settings > Household) while every other route here, like the Worker's, answers for the active
 * profile alone: the Recurring section offered Edit, Delete and "Add to transactions" on another
 * profile's rules, and each answered 404.
 */
export async function recurringList(): Promise<Response> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  try {
    const rows = await db.getAllFromIndex('recurring', 'by_profile', pid)
    // Soonest first, as the Worker orders them (ORDER BY next_date) and the section shows them.
    rows.sort(
      (a, b) =>
        String(a.next_date ?? '').localeCompare(String(b.next_date ?? '')) ||
        Number(a.id) - Number(b.id)
    )
    return json(rows)
  } catch {
    return json([])
  }
}

export async function recurringGet(params: Record<string, string>): Promise<Response> {
  const item = await currentProfileRecord('recurring', idParam(params))
  if (!item) return notFound('Recurring transaction')
  return json(item)
}

export async function recurringCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  for (const [store, id, label] of [
    ['categories', b.category_id, 'Category'],
    ['accounts', b.account_id, 'Account'],
    ['accounts', b.transfer_account_id, 'Transfer account'],
  ] as const) {
    if (!(await currentProfileOwns(store, id))) {
      return json({ error: `${label} does not belong to this profile` }, 400)
    }
  }
  const item = {
    profile_id: pid,
    description: (b.description as string) || '',
    amount: parseFloat(String((b.amount as string | number) || 0)),
    type: (b.type as string) || 'expense',
    frequency: (b.frequency as string) || 'monthly',
    day_of_month: (b.day_of_month as number) || (b.day as number) || 1,
    next_date: (b.next_date as string) || '',
    category_id: (b.category_id as number) || null,
    account_id: (b.account_id as number | null) ?? null,
    transfer_account_id: (b.transfer_account_id as number | null) ?? null,
    notes: (b.notes as string) || '',
    is_active: 1,
    created_at: new Date().toISOString(),
  }
  const invariantError = transactionInvariantError(item)
  if (invariantError) return json({ error: invariantError }, 400)
  const id = await db.add('recurring', item)
  return json({ id, profile_id: pid }, 201)
}

export async function recurringUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const item = await currentProfileRecord('recurring', idParam(params))
  if (!item) return notFound('Recurring transaction')
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    for (const [store, field, label] of [
      ['categories', 'category_id', 'Category'],
      ['accounts', 'account_id', 'Account'],
      ['accounts', 'transfer_account_id', 'Transfer account'],
    ] as const) {
      if (field in b && !(await currentProfileOwns(store, b[field]))) {
        return json({ error: `${label} does not belong to this profile` }, 400)
      }
    }
    if (b.description !== undefined) item.description = b.description
    if (b.amount !== undefined) item.amount = parseFloat(String((b.amount as string | number) || 0))
    if (b.type !== undefined) item.type = b.type
    if (b.frequency !== undefined) item.frequency = b.frequency
    if (b.day_of_month !== undefined) item.day_of_month = b.day_of_month
    if (b.day !== undefined) item.day_of_month = b.day
    if (b.next_date !== undefined) item.next_date = b.next_date
    if (b.category_id !== undefined) item.category_id = b.category_id
    if (b.account_id !== undefined) item.account_id = b.account_id
    if (b.transfer_account_id !== undefined) item.transfer_account_id = b.transfer_account_id
    if (b.notes !== undefined) item.notes = b.notes
    if (b.is_active !== undefined) item.is_active = b.is_active ? 1 : 0
  }
  if (item.type !== 'transfer') item.transfer_account_id = null
  const invariantError = transactionInvariantError(
    item as Parameters<typeof transactionInvariantError>[0]
  )
  if (invariantError) return json({ error: invariantError }, 400)
  await db.put('recurring', item)
  return ok()
}

export async function recurringDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const id = idParam(params)
  if (!(await currentProfileRecord('recurring', id))) return notFound('Recurring transaction')
  await db.delete('recurring', id)
  return ok()
}

export async function recurringUpcoming(): Promise<Response> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  try {
    const all = await db.getAllFromIndex('recurring', 'by_profile', pid)
    const active = all.filter((r: Record<string, unknown>) => r.is_active !== 0)
    return json(active)
  } catch {
    return json([])
  }
}

export async function recurringPopulate(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const item = await currentProfileRecord('recurring', idParam(params))
  if (!item) return notFound('Recurring transaction')
  const invariantError = transactionInvariantError(
    item as Parameters<typeof transactionInvariantError>[0]
  )
  if (invariantError) return json({ error: invariantError }, 400)

  // Today on the person's calendar, NOT toISOString, which is the UTC date and is a day off near
  // midnight in every zone but UTC (audit M-02).
  const todayStr = localToday()
  // Idempotency guard — mirrors the worker: once next_date is in the future the
  // current period is already populated, so a repeat call must not create another
  // transaction (and, now that balances move, must not double-count).
  if (item.next_date && item.next_date > todayStr) {
    return json({ error: 'Recurring transaction already populated for current period' }, 409)
  }
  const date = item.next_date || todayStr
  // Worked out before anything is written: a date it cannot read is refused, not stored as NaN.
  const nextDate = nextOccurrence(date, item.frequency, item.day_of_month)
  if (!nextDate) {
    return json(
      { error: "This rule's next date can't be read. Edit the rule and set its date again." },
      400
    )
  }

  // Go through the adapter so account balances move via computeBalanceDeltas —
  // which handles a two-legged transfer when both account_id and
  // transfer_account_id are set. Keeps serverless mode consistent with the
  // worker/backend populate (income/expense move one account; a transfer moves
  // From -> To; an account-less recurring stays a pure reminder).
  const pid = await adapter.getCurrentProfileId()
  // The recurring rule's amount is denominated in the user's base currency (the recurring
  // form has no currency picker), so the generated transaction inherits that base currency
  // and carries amount_local = amount. This keeps the row identical to the worker's populate
  // for the same rule (was hard-coded 'EUR' here vs the schema-default 'USD' on the worker,
  // audit M-02) and keeps balances/reports in one currency via computeBalanceDeltas.
  const baseCurrency = getLocalCurrency()
  await adapter.createTransaction({
    profile_id: pid,
    description: item.description,
    amount: item.amount,
    type: item.type,
    category_id: item.category_id,
    date,
    currency: baseCurrency,
    amount_local: item.amount,
    reconciled: 0,
    notes: item.notes || '',
    account_id: item.account_id ?? null,
    transfer_account_id: item.transfer_account_id ?? null,
  } as unknown as Parameters<typeof adapter.createTransaction>[0])

  // Advance next_date past the populated period — every frequency must move forward so the
  // guard above can engage on the next call. nextOccurrence works on the date string, the same
  // step as the Worker's: setMonth() overflowed past a shorter month, so a rule on the 31st went
  // from January to 3 March.
  item.next_date = nextDate
  await db.put('recurring', item)

  return json({ ok: true })
}
