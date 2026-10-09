/**
 * Recurring handlers — IndexedDB-backed implementations
 *
 * A body is checked by shared/recurringSchema.ts and the upcoming list worked out by
 * shared/recurringUpcoming.ts, as the Worker does both. A rule is paused with `active`, as the
 * Worker stores it; a rule an older version paused with `is_active` reads as paused too, and is
 * stored with `active` the next time it is written.
 */
import { nextOccurrence } from '../../../../../shared/calendarMonths'
import {
  checkRecurringCreate,
  checkRecurringEdit,
  RECURRING_MESSAGES as M,
  recurringIsActive,
} from '../../../../../shared/recurringSchema'
import { upcomingRecurring } from '../../../../../shared/recurringUpcoming'
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
  refuse,
} from './helpers'
import type { UpcomingRule } from '../../../../../shared/recurringUpcoming'
import type { FieldErrors } from '../../../../../shared/refusal'

type Rule = Record<string, unknown>

/** A stored rule as both runtimes answer it: paused or not as `active`, 1 or 0. */
function answerOf(rule: Rule): Rule {
  const { is_active: _older, ...rest } = rule
  return { ...rest, active: recurringIsActive(rule) ? 1 : 0 }
}

/** The links in `links` that are not the active profile's, as refusals at their fields. */
async function foreignLinks(links: {
  category_id?: number | null
  account_id?: number | null
  transfer_account_id?: number | null
}): Promise<FieldErrors> {
  const fields: FieldErrors = {}
  if (!(await currentProfileOwns('accounts', links.account_id))) fields.account_id = M.account
  if (!(await currentProfileOwns('accounts', links.transfer_account_id))) {
    fields.transfer_account_id = M.transferAccount
  }
  if (!(await currentProfileOwns('categories', links.category_id))) fields.category_id = M.category
  return fields
}

/** The active profile's active rules, each with its category's name, colour and type. */
async function activeRules(): Promise<Rule[]> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const rows = (await db.getAllFromIndex('recurring', 'by_profile', pid)) as Rule[]
  const categories = new Map(
    (await db.getAllFromIndex('categories', 'by_profile', pid)).map((c) => [c.id, c])
  )
  return rows.filter(recurringIsActive).map((r) => {
    const c = categories.get(r.category_id as number)
    return {
      ...answerOf(r),
      category_name: c?.name ?? null,
      category_color: c?.color ?? null,
      category_type: c?.type ?? null,
    }
  })
}

/**
 * The active profile's active rules, as the Worker lists them: a paused rule is left out. This
 * used to read every ticked profile (Settings > Household) while every other route here, like the
 * Worker's, answers for the active profile alone: the Recurring section offered Edit, Delete and
 * "Add to transactions" on another profile's rules, and each answered 404.
 */
export async function recurringList(): Promise<Response> {
  try {
    const rows = await activeRules()
    // Soonest first, as the Worker orders them (ORDER BY next_date) and the section shows them.
    // Each rule carries its category's name, colour and type, joined as the Worker joins them:
    // the Recurring section and the dashboard card colour a rule by its category.
    const next = (r: Rule) => (typeof r.next_date === 'string' ? r.next_date : '')
    rows.sort((a, b) => next(a).localeCompare(next(b)) || Number(a.id) - Number(b.id))
    return json(rows)
  } catch {
    return json([])
  }
}

export async function recurringGet(params: Record<string, string>): Promise<Response> {
  const item = await currentProfileRecord('recurring', idParam(params))
  if (!item) return notFound('Recurring transaction')
  return json(answerOf(item))
}

export async function recurringCreate(body: unknown): Promise<Response> {
  const checked = checkRecurringCreate(body)
  if (!checked.ok) return refuse(checked.fields)
  const foreign = await foreignLinks(checked.value)
  if (Object.keys(foreign).length > 0) return refuse(foreign)
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const item = {
    profile_id: pid,
    ...checked.value,
    active: 1,
    created_at: new Date().toISOString(),
  }
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
  // Only what the edit changes is checked and written (decision 2): a link the rule already holds
  // is not checked again.
  const checked = checkRecurringEdit(body, item)
  if (!checked.ok) return refuse(checked.fields)
  const foreign = await foreignLinks(checked.value)
  if (Object.keys(foreign).length > 0) return refuse(foreign)
  const { active, ...edit } = checked.value
  const updated: Rule = { ...answerOf(item), ...edit }
  if (active !== undefined) updated.active = active ? 1 : 0
  await db.put('recurring', updated)
  return ok()
}

export async function recurringDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const id = idParam(params)
  if (!(await currentProfileRecord('recurring', id))) return notFound('Recurring transaction')
  await db.delete('recurring', id)
  return ok()
}

/** What the active rules add in the next 30 days, as the Worker answers it. */
export async function recurringUpcoming(): Promise<Response> {
  const rules = await activeRules()
  return json(
    upcomingRecurring(rules as unknown as UpcomingRule[], localToday(), getLocalCurrency())
  )
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
    return json({ error: M.populated }, 409)
  }
  const date = item.next_date || todayStr
  // Worked out before anything is written: a date it cannot read is refused, not stored as NaN.
  const nextDate = nextOccurrence(date, item.frequency, item.day_of_month)
  if (!nextDate) return json({ error: M.unreadableNextDate }, 400)

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
  const transactionId = await adapter.createTransaction({
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

  // What the Worker answers: the transaction it added, and the date the rule moved on to.
  return json({ ok: true, transactionId, next_date: nextDate })
}
