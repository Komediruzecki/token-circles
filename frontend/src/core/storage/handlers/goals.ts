/**
 * Goals handlers — IndexedDB-backed implementations
 */
import {
  addToSaved,
  checkContribution,
  checkGoalCreate,
  checkGoalEdit,
  GOAL_MESSAGES,
} from '../../../../../shared/goalSchema'
import { localToday } from '../../../utils/period'
import { getDB } from '../idb'
import {
  adapter,
  currentProfileOwns,
  currentProfileRecord,
  getAmount,
  idParam,
  json,
  notFound,
  ok,
  refuse,
} from './helpers'
import { normalizeSavingsGoal } from './normalize'

// Category-linked goal progress = base-currency sum of that category's transactions
// dated on/after the goal's tracking_start_date (falling back to its creation day).
// Mirrors the worker's recalc-goals so demo mode stays consistent.
export async function recalcGoalsByCategory(categoryId: number | null | undefined): Promise<void> {
  if (!categoryId) return
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  for (const pid of pids) {
    const goals = (await db.getAllFromIndex('goals', 'by_profile', pid)).filter(
      (g) => g.category_id === categoryId
    )
    if (goals.length === 0) continue
    const txns = (await db.getAllFromIndex('transactions', 'by_profile', pid)).filter(
      (t) => t.category_id === categoryId
    )
    for (const g of goals) {
      const start =
        (g.tracking_start_date as string) ||
        (g.created_at ? String(g.created_at).slice(0, 10) : '0000-01-01')
      g.current_amount = txns
        .filter((t) => String(t.date) >= start)
        .reduce((s, t) => s + Math.abs(getAmount(t as Record<string, unknown>)), 0)
      await db.put('goals', g)
    }
  }
}

// Recompute every category-linked goal for the active profile(s). Mirrors the worker's
// recalcAllGoals so demo mode also refreshes progress on page load, independent of which
// mutation path last touched the data.
export async function recalcAllGoals(): Promise<void> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  const cats = new Set<number>()
  for (const pid of pids) {
    for (const g of await db.getAllFromIndex('goals', 'by_profile', pid)) {
      if (g.category_id) cats.add(g.category_id as number)
    }
  }
  for (const c of cats) await recalcGoalsByCategory(c)
}

export async function goalsList(): Promise<Response> {
  // Refresh category-linked progress on load so the page never shows a stale amount.
  try {
    await recalcAllGoals()
  } catch (e) {
    console.error('recalcAllGoals failed', e)
  }
  const goals = await adapter.listGoals()
  return json(goals.map(normalizeSavingsGoal))
}

// The rules and their words are shared/goalSchema.ts, which the Worker and the Goals dialog run
// too. Only the checked fields are stored, `deadline` among them: the body used to be stored as it
// came, the form's `target_date` included.
export async function goalsCreate(body: unknown): Promise<Response> {
  const checked = checkGoalCreate(body, { today: localToday() })
  if (!checked.ok) return refuse(checked.fields)
  const goal = { ...checked.value, profile_id: await adapter.getCurrentProfileId() }
  if (!(await currentProfileOwns('categories', goal.category_id))) {
    return refuse({ category_id: GOAL_MESSAGES.category })
  }
  const id = await adapter.createGoal(goal as unknown as Parameters<typeof adapter.createGoal>[0])
  if (goal.category_id) await recalcGoalsByCategory(goal.category_id)
  const refreshed = await (await getDB()).get('goals', id)
  return json(refreshed ?? { id, ...goal }, 201)
}

export async function goalsGet(params: Record<string, string>): Promise<Response> {
  const goal = await currentProfileRecord('goals', idParam(params))
  if (!goal) return notFound('Goal')
  return json(normalizeSavingsGoal(goal))
}

export async function goalsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const id = idParam(params)
  const before = await currentProfileRecord('goals', id)
  if (!before) return notFound('Goal')
  // Only the fields whose value the edit changes are checked and written (decision 2).
  const checked = checkGoalEdit(body, before)
  if (!checked.ok) {
    console.error('[goalsUpdate] Validation failed', { id, body, fields: checked.fields })
    return refuse(checked.fields)
  }
  const edit = checked.value
  if (
    edit.category_id !== undefined &&
    edit.category_id !== null &&
    !(await currentProfileOwns('categories', edit.category_id))
  ) {
    return refuse({ category_id: GOAL_MESSAGES.category })
  }
  if (Object.keys(edit).length === 0) return ok()
  const row: Record<string, unknown> = { ...before, ...edit }
  // A row the Goals page stored before kept its date as `target_date`, which the page reads when
  // `deadline` is empty: a changed date goes in `deadline` alone, or a cleared one comes back.
  if (edit.deadline !== undefined) delete row.target_date
  await (await getDB()).put('goals', row)
  // Recompute for both the old and new category (the link or tracking date may change).
  const oldCat = before.category_id as number | null | undefined
  const newCat = edit.category_id !== undefined ? edit.category_id : oldCat
  if (oldCat) await recalcGoalsByCategory(oldCat)
  if (newCat && newCat !== oldCat) await recalcGoalsByCategory(newCat)
  return ok()
}

export async function goalsDelete(params: Record<string, string>): Promise<Response> {
  const id = idParam(params)
  if (!(await currentProfileRecord('goals', id))) return notFound('Goal')
  await adapter.deleteGoal(id)
  return ok()
}

/**
 * Add to what a goal has saved: an amount more than zero, to the cent. A string amount used to be
 * added as text, so 100 and "50" made "10050". Read and written in one transaction, so two
 * contributions at once both count.
 */
export async function goalsContribute(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const id = idParam(params)
  if (!(await currentProfileRecord('goals', id))) return notFound('Goal')
  const checked = checkContribution(body)
  if (!checked.ok) return refuse(checked.fields)
  const tx = (await getDB()).transaction('goals', 'readwrite')
  const goal = (await tx.store.get(id)) as Record<string, unknown>
  goal.current_amount = addToSaved(goal.current_amount, checked.value.amount)
  await tx.store.put(goal)
  await tx.done
  return json({ ok: true, current_amount: goal.current_amount })
}
