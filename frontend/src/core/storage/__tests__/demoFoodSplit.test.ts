/**
 * The local-first demo after the Food split: each example profile has Groceries and Eating out, with
 * their kinds, and no Food. The grocery shopping is filed under Groceries and the dining out, which
 * the demo used to file under Entertainment, under Eating out; each has its budget.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getDB, seedDemoProfiles } from '../idb'

type Row = Record<string, unknown> & { id: number }

const DEMO_PROFILES = ['Example Low Income', 'Example Mid Income', 'Example High Income']

beforeAll(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await seedDemoProfiles()
}, 60_000)

describe.each(DEMO_PROFILES)('the demo profile %s', (profileName) => {
  async function rowsOf(store: string): Promise<Row[]> {
    const db = await getDB()
    const profile = ((await db.getAll('profiles')) as Row[]).find((p) => p.name === profileName)
    expect(profile, profileName).toBeDefined()
    return ((await db.getAll(store)) as Row[]).filter((row) => row.profile_id === profile!.id)
  }

  it('has Groceries and Eating out with their kinds, and no Food', async () => {
    const categories = await rowsOf('categories')
    const named = (name: string) => categories.find((c) => c.name === name)
    expect(named('Food')).toBeUndefined()
    expect(named('Groceries')).toMatchObject({ type: 'expense', kind: 'groceries' })
    expect(named('Eating out')).toMatchObject({ type: 'expense', kind: 'eating_out' })
  })

  it('files grocery shopping under Groceries and dining out under Eating out, each budgeted', async () => {
    const categories = await rowsOf('categories')
    const idOf = (name: string) => categories.find((c) => c.name === name)?.id
    const transactions = await rowsOf('transactions')
    const filed = (description: string) =>
      new Set(transactions.filter((t) => t.description === description).map((t) => t.category_id))
    expect(filed('Grocery shopping')).toEqual(new Set([idOf('Groceries')]))
    expect(filed('Dining out')).toEqual(new Set([idOf('Eating out')]))
    const budgeted = new Set((await rowsOf('budgets')).map((b) => b.category_id))
    expect(budgeted.has(idOf('Groceries'))).toBe(true)
    expect(budgeted.has(idOf('Eating out'))).toBe(true)
  })
})
