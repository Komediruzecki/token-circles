/**
 * Goals handlers — IndexedDB-backed implementations
 */
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
} from './helpers'

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
  return json(goals)
}

export async function goalsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid goal data' }, 400)
  const goal = body as Record<string, unknown>
  goal.profile_id = await adapter.getCurrentProfileId()
  if (!(await currentProfileOwns('categories', goal.category_id))) {
    return json({ error: 'Category does not belong to this profile' }, 400)
  }
  const id = await adapter.createGoal(goal as unknown as Parameters<typeof adapter.createGoal>[0])
  if (goal.category_id) await recalcGoalsByCategory(Number(goal.category_id))
  const refreshed = await (await getDB()).get('goals', id)
  return json(refreshed ?? { id, ...goal }, 201)
}

export async function goalsGet(params: Record<string, string>): Promise<Response> {
  const goal = await currentProfileRecord('goals', idParam(params))
  if (!goal) return notFound('Goal')
  return json(goal)
}

export async function goalsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const id = idParam(params)
  const before = await currentProfileRecord('goals', id)
  if (!before) return notFound('Goal')
  const patch = body as Record<string, unknown>
  if ('category_id' in patch && !(await currentProfileOwns('categories', patch.category_id))) {
    return json({ error: 'Category does not belong to this profile' }, 400)
  }
  await adapter.updateGoal(id, patch)
  // Recompute for both the old and new category (the link or tracking date may change).
  const b = body as Record<string, unknown>
  const oldCat = before?.category_id as number | undefined
  const newCat = (b.category_id ?? oldCat) as number | undefined
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

export async function goalsContribute(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const db = await getDB()
  const goal = await currentProfileRecord('goals', idParam(params))
  if (!goal) return notFound('Goal')
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const amount = (body as Record<string, unknown>).amount as number
  goal.current_amount = (goal.current_amount || 0) + amount
  await db.put('goals', goal)
  return json({ ok: true, current_amount: goal.current_amount })
}
