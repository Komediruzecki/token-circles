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
