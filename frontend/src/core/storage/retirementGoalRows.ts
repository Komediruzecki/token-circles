/**
 * Retirement goals in browser mode, kept as the Worker keeps them in its retirement_goals table
 * (worker/src/routes/retirement-goals.ts): the fields a stored row has, and how to recognise one
 * that a build before v13 filed among the savings goals. Pure, so the IndexedDB upgrade, a backup
 * restore and the request handlers all apply the same rules.
 */

type Row = Record<string, unknown>

/** The Retirement page sends all three on every save, an empty one as null. Nothing else does. */
const RETIREMENT_ONLY_FIELDS = ['current_age', 'retirement_age', 'expected_return_rate']

/** Carried by savings goals (the Goals page, the demo seed, a server backup) and never sent by
 *  the Retirement page. */
const SAVINGS_ONLY_FIELDS = ['category_id', 'tracking_start_date', 'notes']

/**
 * Before v13 a retirement goal was stored among the savings goals, as the body the page sent.
 * Only a row with a retirement field and no savings field is certainly one. A row with both was
 * saved through both pages, which that bug allowed, and stays a savings goal rather than be moved
 * on a guess.
 */
export function isLegacyRetirementGoal(row: Row): boolean {
  return (
    RETIREMENT_ONLY_FIELDS.some((field) => field in row) &&
    !SAVINGS_ONLY_FIELDS.some((field) => field in row)
  )
}

/**
 * The columns the Worker's insert writes for a request body. The page sends its date as
 * `target_date`, which is stored as `deadline`, and a field left empty takes the column default.
 */
export function retirementGoalFields(b: Row): Row {
  const fields: Row = {
    current_amount: b.current_amount || 0,
    deadline: b.deadline || b.target_date || null,
    notes: b.notes || '',
    current_age: b.current_age || 30,
    retirement_age: b.retirement_age || 65,
    monthly_contribution: b.monthly_contribution || 0,
    expected_return_rate: b.expected_return_rate || 7,
  }
  if (b.name !== undefined) fields.name = b.name
  if (b.target_amount !== undefined) fields.target_amount = b.target_amount
  return fields
}

/** A row stored before v13, or restored from a backup, in the shape the handlers write now. */
export function asRetirementGoalRow(row: Row): Row {
  const { target_date: _targetDate, ...rest } = row
  return { ...rest, ...retirementGoalFields(row) }
}

/**
 * An edit: the body's fields, with the defaults the Worker's PUT applies, over the stored row,
 * whose id, profile and creation date the body cannot change. A field the body leaves out keeps
 * its stored value, where the Worker's PUT would reset it; the page sends every field, so it sees
 * no difference. The date moves only when the body carries one, under either name, so a cleared
 * date clears it.
 */
export function editedRetirementGoal(existing: Row, b: Row): Row {
  const dated = b.deadline !== undefined || b.target_date !== undefined
  const deadline = dated ? b.deadline || b.target_date || null : (existing.deadline ?? null)
  return { ...existing, ...retirementGoalFields({ ...existing, ...b, deadline }) }
}

interface AddableStore {
  add(value: Row): Promise<unknown>
}

/**
 * Add rows keeping each one's id, unless an earlier row in the same call took it, as rows from two
 * sources can. Those are added last, without an id, and get a fresh one: added first, an id handed
 * out by the store could collide with one kept after it.
 */
export async function addKeepingIds(store: AddableStore, rows: Row[]): Promise<void> {
  const kept = new Set<number>()
  const renumbered: Row[] = []
  for (const row of rows) {
    const id = row.id
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && !kept.has(id)) {
      kept.add(id)
      await store.add(row)
    } else {
      renumbered.push(row)
    }
  }
  for (const { id: _id, ...row } of renumbered) await store.add(row)
}
