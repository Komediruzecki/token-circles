/**
 * Housing handlers — IndexedDB-backed implementations
 *
 * A body is checked by shared/housingSchema.ts, as the Worker checks it, and a row is stored and
 * answered as the Worker's columns.
 */
import {
  checkHousingCreate,
  checkHousingEdit,
  housingAnswer,
  housingRowOf,
} from '../../../../../shared/housingSchema'
import { localHousingDefaults } from '../../validation'
import { getDB } from '../idb'
import { adapter, currentProfileRecord, idParam, json, notFound, ok, refuse } from './helpers'

export async function housingList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('housings', 'by_profile', pid)
      // The Worker's columns, autopay as true or false: older rows also kept the form's fields.
      all.push(...rows.map((row: Record<string, unknown>) => housingAnswer(row)))
    }
    const total = all.reduce(
      (s, h) => s + Math.abs(parseFloat(String((h.monthly_amount as number) || 0))),
      0
    )
    // Soonest due first ("MM-DD"), as the Worker lists them and the Housing page shows them.
    const dueDay = (h: Record<string, unknown>) =>
      typeof h.due_date === 'string' ? h.due_date : ''
    all.sort((a, b) => dueDay(a).localeCompare(dueDay(b)))
    return json({ housings: all, total_monthly: Math.round(total) })
  } catch {
    return json({ housings: [], total_monthly: 0 })
  }
}

export async function housingCreate(body: unknown): Promise<Response> {
  const checked = checkHousingCreate(body, localHousingDefaults())
  if (!checked.ok) return refuse(checked.fields)
  const row = housingRowOf(checked.value)
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const id = await db.add('housings', {
    profile_id: pid,
    ...row,
    autopay: row.autopay ? 1 : 0,
    created_at: new Date().toISOString(),
  })
  return json({ id }, 201)
}

export async function housingGet(params: Record<string, string>): Promise<Response> {
  const h = await currentProfileRecord('housings', idParam(params))
  if (h) h.autopay = h.autopay === 1 || h.autopay === true
  return h ? json(h) : notFound('Housing expense')
}

export async function housingUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const h = await currentProfileRecord('housings', idParam(params))
  if (!h) return notFound('Housing expense')
  // Only what the edit changes is checked and written (decision 2): a field left out stays.
  const checked = checkHousingEdit(body, h, localHousingDefaults())
  if (!checked.ok) return refuse(checked.fields)
  const edit = checked.value
  Object.assign(h, edit)
  if (edit.autopay !== undefined) h.autopay = edit.autopay ? 1 : 0
  // Older versions kept the form's fields beside the columns; once the row changes they could
  // only disagree with them.
  delete h.property_name
  delete h.due_day
  delete h.due_month
  await db.put('housings', h)
  return ok()
}

export async function housingDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const id = idParam(params)
  if (!(await currentProfileRecord('housings', id))) return notFound('Housing expense')
  await db.delete('housings', id)
  return ok()
}

export async function housingCalculate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const grossIncome = parseFloat(String((b.gross_income as string | number) || 0))
  const livingExpenses = parseFloat(String((b.living_expenses as string | number) || 0))
  const transportCost = parseFloat(String((b.transport_cost as string | number) || 0))
  const utilitiesCost = parseFloat(String((b.utilities_cost as string | number) || 0))
  const savingsTarget = parseFloat(String((b.savings_target as string | number) || 0))

  // Standard 30% rule: housing should not exceed 30% of gross income
  const affordableRent = Math.round(grossIncome * 0.3 * 100) / 100
  const totalNonHousingExpenses = livingExpenses + transportCost + utilitiesCost + savingsTarget
  const maxAvailable = Math.max(0, grossIncome - totalNonHousingExpenses)
  const recommendedRent = Math.round(Math.min(affordableRent, maxAvailable) * 100) / 100
  const housingRatio =
    grossIncome > 0 ? Math.round((recommendedRent / grossIncome) * 10000) / 100 : 0

  const total = grossIncome
  const breakdown = [
    {
      name: 'Housing (recommended)',
      amount: recommendedRent,
      percentage: total > 0 ? Math.round((recommendedRent / total) * 10000) / 100 : 0,
    },
    {
      name: 'Living Expenses',
      amount: livingExpenses,
      percentage: total > 0 ? Math.round((livingExpenses / total) * 10000) / 100 : 0,
    },
    {
      name: 'Transport',
      amount: transportCost,
      percentage: total > 0 ? Math.round((transportCost / total) * 10000) / 100 : 0,
    },
    {
      name: 'Utilities',
      amount: utilitiesCost,
      percentage: total > 0 ? Math.round((utilitiesCost / total) * 10000) / 100 : 0,
    },
    {
      name: 'Savings',
      amount: savingsTarget,
      percentage: total > 0 ? Math.round((savingsTarget / total) * 10000) / 100 : 0,
    },
    {
      name: 'Remaining',
      amount: Math.max(0, grossIncome - totalNonHousingExpenses - recommendedRent),
      percentage:
        total > 0
          ? Math.round(
              (Math.max(0, grossIncome - totalNonHousingExpenses - recommendedRent) / total) * 10000
            ) / 100
          : 0,
    },
  ]

  return json({
    grossIncome,
    livingExpenses,
    transportCost,
    utilitiesCost,
    savingsTarget,
    housingRatio,
    affordableRent,
    recommendedRent,
    monthlySpendingBreakdown: breakdown,
  })
}
