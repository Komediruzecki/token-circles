/**
 * Housing handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, notFound, ok } from './helpers'

export async function housingList(): Promise<Response> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  try {
    const all: Record<string, unknown>[] = []
    for (const pid of pids) {
      const rows = await db.getAllFromIndex('housings', 'by_profile', pid)
      for (const h of rows) {
        h.autopay = h.autopay === 1 || h.autopay === true
      }
      all.push(...rows)
    }
    const total = all.reduce(
      (s, h) => s + Math.abs(parseFloat(String((h.monthly_amount as number) || 0))),
      0
    )
    return json({ housings: all, total_monthly: Math.round(total) })
  } catch {
    return json({ housings: [], total_monthly: 0 })
  }
}

export async function housingCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const b = body as Record<string, unknown>
  const property_name = (b.property_name as string) || (b.name as string) || ''
  const amount = parseFloat(String((b.monthly_amount as string | number) || 0))
  if (!property_name || isNaN(amount) || amount <= 0) {
    return json({ error: 'Property name and a valid monthly amount are required' }, 400)
  }
  const due_day = (b.due_day as number) || 1
  const due_month = (b.due_month as number) || new Date().getMonth() + 1
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const id = await db.add('housings', {
    profile_id: pid,
    name: property_name,
    type: (b.type as string) || 'other',
    monthly_amount: amount,
    due_date: `${String(due_month).padStart(2, '0')}-${String(due_day).padStart(2, '0')}`,
    due_day,
    due_month,
    autopay: b.autopay ? 1 : 0,
    notes: (b.notes as string) || '',
    created_at: new Date().toISOString(),
    property_name,
  })
  return json({ id }, 201)
}

export async function housingGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const h = await db.get('housings', idParam(params))
  if (h) h.autopay = h.autopay === 1 || h.autopay === true
  return h ? json(h) : notFound('Housing expense')
}

export async function housingUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const h = await db.get('housings', idParam(params))
  if (!h) return notFound('Housing expense')
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.property_name !== undefined) h.name = b.property_name
    if (b.type !== undefined) h.type = b.type
    if (b.monthly_amount !== undefined)
      h.monthly_amount = parseFloat(String((b.monthly_amount as string | number) || 0))
    if (b.due_day !== undefined) h.due_day = Number(b.due_day)
    if (b.due_month !== undefined) h.due_month = Number(b.due_month)
    if (b.autopay !== undefined) h.autopay = b.autopay ? 1 : 0
    if (b.notes !== undefined) h.notes = b.notes
    if (b.due_day !== undefined || b.due_month !== undefined) {
      h.due_date = `${String(h.due_month || 1).padStart(2, '0')}-${String(h.due_day || 1).padStart(2, '0')}`
    }
    h.property_name = h.name
  }
  await db.put('housings', h)
  return ok()
}

export async function housingDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  await db.delete('housings', idParam(params))
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
