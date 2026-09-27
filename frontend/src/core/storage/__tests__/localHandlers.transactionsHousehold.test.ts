/**
 * In household view each transaction carries its own profile's category, receipt and tags.
 *
 * The list reads rows from every selected profile, but looked their categories, receipts and tags
 * up in the active profile's alone. So every other profile's rows showed no category, no receipt
 * and no tags, and a tag filter could never match them. The Worker joins each row to its own
 * profile's category and receipt (`c.profile_id = t.profile_id`) and attaches the tags of every
 * selected profile's rows.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { transactionsList } from '../localHandlers.js'

type ListedRow = {
  description: string
  category_name: string | null
  category_color: string | null
  receipt_id: number | null
  receipt_name: string | null
  tags: { id: number; name: string; color: string }[]
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', JSON.stringify([1, 2]))
  const db = await getDB()
  for (const store of ['profiles', 'transactions', 'categories', 'tags', 'receipts'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01' })
  await db.add('profiles', { id: 2, name: 'Family', created_at: '2026-01-01' })
  await db.add('categories', {
    id: 1,
    profile_id: 1,
    name: 'Food',
    type: 'expense',
    color: '#ef4444',
  })
  await db.add('categories', {
    id: 2,
    profile_id: 2,
    name: 'Garden',
    type: 'expense',
    color: '#84cc16',
  })
  await db.add('tags', { id: 5, profile_id: 1, name: 'Holiday', color: '#f97316' })
  await db.add('tags', { id: 9, profile_id: 2, name: 'Allotment', color: '#22c55e' })
})

async function addTransaction(row: Record<string, unknown>): Promise<number> {
  const db = await getDB()
  const values = { amount: 20, type: 'expense', date: '2026-09-20', notes: '', ...row }
  return (await db.add('transactions', values)) as number
}

async function listed(): Promise<Record<string, ListedRow>> {
  const rows = (await (await transactionsList(new URLSearchParams())).json()) as ListedRow[]
  return Object.fromEntries(rows.map((row) => [row.description, row]))
}

describe('the local transaction list in household view', () => {
  it('gives another profile’s row its own category, receipt and tags', async () => {
    await addTransaction({ profile_id: 1, description: 'Lunch', category_id: 1, tag_ids: [5] })
    const seeds = await addTransaction({
      profile_id: 2,
      description: 'Seeds',
      category_id: 2,
      tag_ids: [9],
    })
    const db = await getDB()
    const receipt = { profile_id: 2, transaction_id: seeds, original_name: 'seeds.pdf' }
    const receiptId = (await db.add('receipts', receipt)) as number

    const rows = await listed()

    expect(rows.Seeds).toMatchObject({
      category_name: 'Garden',
      category_color: '#84cc16',
      receipt_id: receiptId,
      receipt_name: 'seeds.pdf',
      tags: [{ id: 9, name: 'Allotment', color: '#22c55e' }],
    })
    expect(rows.Lunch).toMatchObject({
      category_name: 'Food',
      tags: [{ id: 5, name: 'Holiday', color: '#f97316' }],
    })
  })

  it('never lends a row another profile’s category or receipt, as the Worker’s joins do not', async () => {
    // A row can only point at its own profile's category, so this is a stale id, as a restored
    // backup or an old import could leave. The Worker's join then finds nothing.
    const lunch = await addTransaction({ profile_id: 1, description: 'Lunch', category_id: 2 })
    const db = await getDB()
    await db.add('receipts', { profile_id: 2, transaction_id: lunch, original_name: 'other.pdf' })

    const rows = await listed()

    expect(rows.Lunch).toMatchObject({
      category_name: null,
      category_color: null,
      receipt_id: null,
      receipt_name: null,
    })
  })

  it('reads only the selected profiles', async () => {
    localStorage.setItem('selectedProfileIds', JSON.stringify([1]))
    await addTransaction({ profile_id: 1, description: 'Lunch', category_id: 1 })
    await addTransaction({ profile_id: 2, description: 'Seeds', category_id: 2 })

    expect(Object.keys(await listed())).toEqual(['Lunch'])
  })
})
