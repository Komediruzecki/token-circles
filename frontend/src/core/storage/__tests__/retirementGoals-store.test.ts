/**
 * Retirement goals in browser mode live in their own store, as they have their own table in the
 * Worker: retirement_goals, apart from savings_goals.
 *
 * They used to be written into the savings-goal store, so each list showed the other's rows. A
 * retirement goal appeared on the Goals page and in the achievements evaluation; a savings goal
 * appeared in the retirement planner, where PUT and DELETE /retirement-goals/:id would edit or
 * delete it. A backup carried them inside `goals`, so a server restore filed them as savings goals
 * and dropped their retirement fields, and a server backup's own retirement goals were parked
 * where no page could show them.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_EXTENSION_SETTINGS_KEY } from '../backup.js'
import { adapter } from '../handlers/helpers.js'
import { getDB } from '../idb.js'
import { routeApiRequest } from '../localApiRouter.js'
import type { ExportData } from '../../../types/storage.js'

type Row = Record<string, unknown> & { id: number }

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/

/** Exactly what the Retirement page posts: all eight fields, an empty one as null. */
const PAGE_FORM = {
  name: 'Retire at 60',
  target_amount: 900000,
  current_amount: 120000,
  target_date: '2046-06-30',
  monthly_contribution: 1500,
  expected_return_rate: 6,
  current_age: 41,
  retirement_age: 60,
}

/** Exactly what the Goals page posts for a goal with no category. */
const GOALS_FORM = {
  name: 'New Car',
  target_amount: 5000,
  target_date: '2027-06-30',
  monthly_contribution: null,
  category_id: null,
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return routeApiRequest(`/api${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function retirementList(): Promise<{ goals: Row[]; settings: Record<string, unknown> }> {
  const res = await call('GET', '/retirement-goals')
  expect(res.status).toBe(200)
  return res.json()
}

async function savingsList(): Promise<Row[]> {
  const res = await call('GET', '/savings-goals')
  expect(res.status).toBe(200)
  return res.json()
}

async function createRetirementGoal(body: Record<string, unknown> = PAGE_FORM): Promise<number> {
  const res = await call('POST', '/retirement-goals', body)
  expect(res.ok, `POST /retirement-goals ${res.status}`).toBe(true)
  return ((await res.json()) as { id: number }).id
}

async function createSavingsGoal(body: Record<string, unknown> = GOALS_FORM): Promise<number> {
  const res = await call('POST', '/savings-goals', body)
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: number }).id
}

const names = (rows: ReadonlyArray<object>): string[] =>
  rows.map((r) => String((r as { name?: unknown }).name)).sort()

function useProfile(id: number, household?: number[]): void {
  localStorage.setItem('currentProfileId', String(id))
  if (household) localStorage.setItem('selectedProfileIds', JSON.stringify(household))
  else localStorage.removeItem('selectedProfileIds')
}

beforeEach(async () => {
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01T00:00:00.000Z' })
  useProfile(1)
})

describe('retirement goals and savings goals are separate lists', () => {
  it('a retirement goal stays off the savings list, and a savings goal off the retirement list', async () => {
    await createRetirementGoal()
    await createSavingsGoal()

    expect(names(await savingsList())).toEqual(['New Car'])
    expect(names((await retirementList()).goals)).toEqual(['Retire at 60'])
  })

  it('the retirement routes cannot edit or delete a savings goal', async () => {
    const savingsId = await createSavingsGoal()

    expect((await call('PUT', `/retirement-goals/${savingsId}`, PAGE_FORM)).status).toBe(404)
    expect((await call('DELETE', `/retirement-goals/${savingsId}`)).status).toBe(404)

    const res = await call('GET', `/savings-goals/${savingsId}`)
    expect(res.status).toBe(200)
    const goal = (await res.json()) as Row
    expect(goal.name).toBe('New Car')
    expect(goal).not.toHaveProperty('current_age')
  })

  it("nor another profile's retirement goal", async () => {
    useProfile(2)
    const theirs = await createRetirementGoal({ ...PAGE_FORM, name: 'Partner plan' })
    useProfile(1)

    expect((await call('PUT', `/retirement-goals/${theirs}`, PAGE_FORM)).status).toBe(404)
    expect((await call('DELETE', `/retirement-goals/${theirs}`)).status).toBe(404)

    useProfile(2)
    expect(names((await retirementList()).goals)).toEqual(['Partner plan'])
  })

  it('nor a goal that does not exist', async () => {
    expect((await call('PUT', '/retirement-goals/7777', PAGE_FORM)).status).toBe(404)
    expect((await call('DELETE', '/retirement-goals/7777')).status).toBe(404)
    expect(await (await getDB()).getAll('retirement_goals')).toEqual([])
  })

  it('a savings goal and a retirement goal with the same id are two goals', async () => {
    // Each store numbers its own rows, so the two lists can hold the same id.
    const id = await createSavingsGoal()
    await (await getDB()).add('retirement_goals', { ...PAGE_FORM, id, profile_id: 1 })

    const renamed = { ...PAGE_FORM, name: 'Renamed' }
    expect((await call('PUT', `/retirement-goals/${id}`, renamed)).status).toBe(200)
    expect(names((await retirementList()).goals)).toEqual(['Renamed'])
    expect((await call('DELETE', `/retirement-goals/${id}`)).status).toBe(200)

    expect((await retirementList()).goals).toEqual([])
    expect(await savingsList()).toEqual([expect.objectContaining({ id, name: 'New Car' })])
  })

  it('the planner takes the age from a retirement goal, never from a savings goal', async () => {
    // A savings goal that was once saved through the Retirement page carries an age. It stays a
    // savings goal (it has a category_id), so its age must not reach the planner.
    await (
      await getDB()
    ).add('goals', {
      name: 'Edited on both pages',
      target_amount: 10,
      current_age: 25,
      category_id: null,
      profile_id: 1,
    })
    const age = async (): Promise<unknown> => {
      const res = await call('GET', '/retirement/settings')
      expect(res.status).toBe(200)
      return ((await res.json()) as { facts: { currentAge: unknown } }).facts.currentAge
    }
    expect(await age()).toBeNull()

    await createRetirementGoal()
    expect(await age()).toBe(41)

    // As in the worker, the newest goal's age is the one taken.
    await createRetirementGoal({ ...PAGE_FORM, name: 'Later plan', current_age: 50 })
    expect(await age()).toBe(50)
  })
})

describe("the Worker's retirement-goal contract", () => {
  it('POST stores the row the Worker would, and echoes the same fields', async () => {
    const res = await call('POST', '/retirement-goals', PAGE_FORM)
    expect(res.status).toBe(200)
    const echoed = (await res.json()) as Row
    expect(echoed).toEqual({
      id: expect.any(Number),
      name: 'Retire at 60',
      target_amount: 900000,
      current_amount: 120000,
      deadline: '2046-06-30',
      profile_id: 1,
    })

    const stored = await (await getDB()).get('retirement_goals', echoed.id)
    expect(stored).toEqual({
      id: echoed.id,
      profile_id: 1,
      name: 'Retire at 60',
      target_amount: 900000,
      current_amount: 120000,
      deadline: '2046-06-30',
      notes: '',
      current_age: 41,
      retirement_age: 60,
      monthly_contribution: 1500,
      expected_return_rate: 6,
      created_at: expect.stringMatching(TIMESTAMP),
    })
  })

  it('a field left empty on the page takes the Worker default', async () => {
    const id = await createRetirementGoal({
      name: 'Blank',
      target_amount: 100,
      current_amount: null,
      target_date: '',
      monthly_contribution: null,
      expected_return_rate: null,
      current_age: null,
      retirement_age: null,
    })
    expect(await (await getDB()).get('retirement_goals', id)).toMatchObject({
      current_amount: 0,
      deadline: null,
      monthly_contribution: 0,
      expected_return_rate: 7,
      current_age: 30,
      retirement_age: 65,
    })
  })

  it('POST files the goal under the active profile, whatever the body says', async () => {
    const id = await createRetirementGoal({ ...PAGE_FORM, id: 7777, profile_id: 2 })

    expect(id).not.toBe(7777)
    expect(await (await getDB()).get('retirement_goals', id)).toMatchObject({ profile_id: 1 })
    useProfile(2)
    expect((await retirementList()).goals).toEqual([])
  })

  it('POST without a name or a target amount is refused, and stores nothing', async () => {
    expect((await call('POST', '/retirement-goals', { ...PAGE_FORM, name: '' })).status).toBe(400)
    const { target_amount: _omitted, ...noTarget } = PAGE_FORM
    expect((await call('POST', '/retirement-goals', noTarget)).status).toBe(400)
    expect(await (await getDB()).getAll('retirement_goals')).toEqual([])
  })

  it('PUT moves the date with the form, and a cleared date leaves none behind', async () => {
    const id = await createRetirementGoal()

    let res = await call('PUT', `/retirement-goals/${id}`, {
      ...PAGE_FORM,
      target_date: '2050-01-31',
      current_age: 42,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    let stored = await (await getDB()).get('retirement_goals', id)
    expect(stored).toMatchObject({ deadline: '2050-01-31', current_age: 42 })
    expect(stored).not.toHaveProperty('target_date')

    res = await call('PUT', `/retirement-goals/${id}`, { ...PAGE_FORM, target_date: '' })
    expect(res.status).toBe(200)
    stored = await (await getDB()).get('retirement_goals', id)
    expect(stored.deadline).toBeNull()
    // The page shows `deadline || target_date`: nothing stale may remain for it to fall back to.
    const [listed] = (await retirementList()).goals
    expect(listed.deadline || listed.target_date || '').toBe('')
    // And the creation date is not rewritten by an edit.
    expect(stored.created_at).toMatch(TIMESTAMP)
  })

  it('PUT with only some fields keeps the rest, and cannot move the goal or rewrite its id', async () => {
    const id = await createRetirementGoal()
    const db = await getDB()
    const before = await db.get('retirement_goals', id)

    expect((await call('PUT', `/retirement-goals/${id}`, { name: 'Renamed' })).status).toBe(200)
    expect(await db.get('retirement_goals', id)).toEqual({ ...before, name: 'Renamed' })

    const res = await call('PUT', `/retirement-goals/${id}`, {
      ...PAGE_FORM,
      id: 7777,
      profile_id: 2,
      created_at: '2000-01-01T00:00:00.000Z',
    })
    expect(res.status).toBe(200)
    expect(await db.get('retirement_goals', id)).toEqual(before)
    expect(await db.get('retirement_goals', 7777)).toBeUndefined()
  })

  it('GET orders a restored worker row by its time, and a row with no creation date last', async () => {
    const db = await getDB()
    const goal = (name: string, createdAt?: string) =>
      db.add('retirement_goals', {
        ...PAGE_FORM,
        name,
        profile_id: 1,
        ...(createdAt ? { created_at: createdAt } : {}),
      })
    await goal('No date')
    await goal('Here, 09:00', '2026-05-01T09:00:00.000Z')
    // D1 writes its timestamps without the T and the zone.
    await goal('Worker, 12:00', '2026-05-01 12:00:00')
    // Between two rows with the same date, the later one is newer.
    await goal('No date either')

    expect((await retirementList()).goals.map((g) => g.name)).toEqual([
      'Worker, 12:00',
      'Here, 09:00',
      'No date either',
      'No date',
    ])
  })

  it("GET lists the household's goals newest first, with the active profile's saved plan", async () => {
    const db = await getDB()
    const goal = (name: string, profileId: number, createdAt: string) =>
      db.add('retirement_goals', {
        ...PAGE_FORM,
        name,
        profile_id: profileId,
        created_at: createdAt,
      })
    await goal('January, mine', 1, '2026-01-01T00:00:00.000Z')
    await goal('March, partner', 2, '2026-03-01T00:00:00.000Z')
    await goal('February, mine', 1, '2026-02-01T00:00:00.000Z')

    let list = await retirementList()
    expect(list.goals.map((g) => g.name)).toEqual(['February, mine', 'January, mine'])
    expect(list.settings).toEqual({})

    useProfile(1, [1, 2])
    const saved = await call('PUT', '/retirement/settings', { annualReturnPct: 5 })
    expect(saved.status).toBe(200)
    // The Worker returns the stored plan as saved, so compare against the stored row.
    const stored = await db.get('settings', 'retirement_settings:1')
    expect(stored.value).toMatchObject({ annualReturnPct: 5 })

    list = await retirementList()
    expect(list.goals.map((g) => g.name)).toEqual([
      'March, partner',
      'February, mine',
      'January, mine',
    ])
    expect(list.settings).toEqual(stored.value)
  })
})

describe('backups', () => {
  it('an export carries retirement goals as retirementGoals, and never inside goals', async () => {
    await createRetirementGoal()
    await createSavingsGoal()
    useProfile(2)
    await createRetirementGoal({ ...PAGE_FORM, name: 'Partner plan' })

    const all = await adapter.exportData()
    expect(names(all.retirementGoals ?? [])).toEqual(['Partner plan', 'Retire at 60'])
    expect(names(all.goals)).toEqual(['New Car'])

    const mine = await adapter.exportData([1])
    expect(names(mine.retirementGoals ?? [])).toEqual(['Retire at 60'])
  })

  it("a server backup's retirement goals restore into the retirement list", async () => {
    const backup: ExportData = await adapter.exportData()
    backup.goals = [
      {
        id: 3,
        profile_id: 1,
        name: 'Holiday',
        target_amount: 2000,
        current_amount: 0,
        deadline: null,
        notes: '',
        category_id: null,
        monthly_contribution: 0,
        tracking_start_date: null,
        created_at: '2026-04-01 09:00:00',
      },
    ] as unknown as ExportData['goals']
    backup.retirementGoals = [
      {
        id: 7,
        profile_id: 2,
        name: 'Server plan',
        target_amount: 500000,
        current_amount: 0,
        deadline: '2045-01-01',
        notes: '',
        current_age: 35,
        retirement_age: 67,
        monthly_contribution: 800,
        expected_return_rate: 7,
        created_at: '2026-05-01 10:00:00',
      },
    ]

    await adapter.importData(backup)

    const db = await getDB()
    const partner = (await db.getAll('profiles')).find((p) => p.name === 'Partner')
    useProfile(partner!.id as number)
    expect((await retirementList()).goals).toEqual([
      expect.objectContaining({ id: 7, name: 'Server plan', deadline: '2045-01-01' }),
    ])
    expect(await savingsList()).toEqual([])

    const me = (await db.getAll('profiles')).find((p) => p.name === 'Me')
    useProfile(me!.id as number)
    expect(names(await savingsList())).toEqual(['Holiday'])
    expect((await retirementList()).goals).toEqual([])

    // Nothing is parked out of sight any more.
    const parked = await db.get('settings', BACKUP_EXTENSION_SETTINGS_KEY)
    expect(parked.value.retirementGoals).toEqual([])
  })

  it('a backup made before this fix, with retirement goals inside goals, restores them where they belong', async () => {
    const backup: ExportData = await adapter.exportData()
    backup.goals = [
      // What the old handler stored: the page's body as sent, plus its profile.
      { id: 1, profile_id: 1, ...PAGE_FORM },
      { id: 2, profile_id: 1, ...GOALS_FORM },
      // Saved through both pages: stays a savings goal rather than be moved on a guess.
      {
        id: 3,
        profile_id: 1,
        ...PAGE_FORM,
        name: 'Edited on both pages',
        category_id: null,
      },
    ] as unknown as ExportData['goals']
    backup.retirementGoals = []

    await adapter.importData(backup)

    const [restored] = (await retirementList()).goals
    expect(restored).toMatchObject({ id: 1, name: 'Retire at 60', deadline: '2046-06-30' })
    expect(restored).not.toHaveProperty('target_date')
    expect((await retirementList()).goals).toHaveLength(1)
    expect(names(await savingsList())).toEqual(['Edited on both pages', 'New Car'])
  })

  it('a restore does not fail when a goal from goals and one from retirementGoals share an id', async () => {
    const backup: ExportData = await adapter.exportData()
    backup.goals = [{ id: 5, profile_id: 1, ...PAGE_FORM }] as unknown as ExportData['goals']
    backup.retirementGoals = [
      { id: 5, profile_id: 1, ...PAGE_FORM, name: 'Same id', deadline: '2044-01-01' },
    ]

    await adapter.importData(backup)

    expect(names((await retirementList()).goals)).toEqual(['Retire at 60', 'Same id'])
  })

  it('export, restore and export again gives back the same retirement goals', async () => {
    await createRetirementGoal()
    useProfile(2)
    await createRetirementGoal({ ...PAGE_FORM, name: 'Partner plan', current_age: 44 })

    const first = await adapter.exportData()
    await adapter.importData(first)
    const second = await adapter.exportData()

    const comparable = (rows: Array<Record<string, unknown>> = []) =>
      rows
        .map(({ profile_id: _profile, ...row }) => row)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    expect(comparable(second.retirementGoals)).toEqual(comparable(first.retirementGoals))
    expect(second.retirementGoals).toHaveLength(2)
  })

  it('a full restore replaces the retirement goals that were there', async () => {
    const empty = await adapter.exportData()
    await createRetirementGoal({ ...PAGE_FORM, name: 'Made after the backup' })

    await adapter.importData(empty)

    expect(await (await getDB()).getAll('retirement_goals')).toEqual([])
  })
})

describe('Danger Zone', () => {
  it("clearing a profile's data removes its retirement goals and nobody else's", async () => {
    await createRetirementGoal()
    useProfile(2)
    await createRetirementGoal({ ...PAGE_FORM, name: 'Partner plan' })

    await adapter.clearProfileData([1])

    expect(names(await (await getDB()).getAll('retirement_goals'))).toEqual(['Partner plan'])
  })

  it('clearing all data empties the retirement store', async () => {
    await createRetirementGoal()

    await adapter.clearAllData()

    expect(await (await getDB()).getAll('retirement_goals')).toEqual([])
  })
})
