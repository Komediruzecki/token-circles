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

/** Nothing there: a field a row never had, or one the page sent empty. */
const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || Number.isNaN(value)

/**
 * A row stored before v13, or restored from a backup, in the shape the handlers write now: the
 * date as `deadline`, and a field the row has no value for at the column's default. A field it has
 * keeps its value: a 0 % return stays 0 %, where `|| 7` made it 7 %.
 */
export function asRetirementGoalRow(row: Row): Row {
  const { target_date: _targetDate, ...rest } = row
  const or = (value: unknown, blank: unknown) => (isBlank(value) ? blank : value)
  return {
    ...rest,
    current_amount: or(row.current_amount, 0),
    deadline: row.deadline || row.target_date || null,
    notes: or(row.notes, ''),
    current_age: or(row.current_age, 30),
    retirement_age: or(row.retirement_age, 65),
    monthly_contribution: or(row.monthly_contribution, 0),
    expected_return_rate: or(row.expected_return_rate, 7),
  }
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
