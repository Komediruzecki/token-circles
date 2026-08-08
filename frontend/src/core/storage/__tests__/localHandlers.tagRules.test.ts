import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  tagRulesCreate,
  tagRulesDelete,
  tagRulesList,
  tagRulesPreview,
  tagRulesUpdate,
  tagsApplyRules,
  tagsBulkTagTransactions,
  tagsCreate,
  tagsDelete,
  tagsSummary,
  tagSummary,
  transactionsCreate,
  transactionsList,
} from '../localHandlers.js'

const EMPTY_QUERY = new URLSearchParams()

async function seedTransaction(patch: Record<string, unknown>): Promise<number> {
  const res = await transactionsCreate({
    amount: 100,
    type: 'expense',
    date: '2026-03-15',
    description: 'Generic',
    ...patch,
  })
  const body = await res.json()
  return body.id as number
}

describe('localHandlers - tag rules', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    for (const store of [
      'profiles',
      'tags',
      'tagRules',
      'transactions',
      'categories',
      'accounts',
    ]) {
      await db.clear(store)
    }
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
    await db.add('categories', { id: 10, profile_id: 1, name: 'Software', type: 'expense' })
    await db.add('categories', { id: 11, profile_id: 1, name: 'Food', type: 'expense' })
  })

  async function makeTag(name = 'Company'): Promise<number> {
    const res = await tagsCreate({ name, color: '#6e9bff' })
    return (await res.json()).id as number
  }

  // Both the tag_ids and the denormalized tags[] copy — bulk ops must keep them in step.
  async function tagsOf(txId: number): Promise<{ ids: number[]; names: string[] }> {
    const db = await getDB()
    const row = (await db.get('transactions', txId)) as
      | { tag_ids?: number[]; tags?: { id: number; name: string }[] }
      | undefined
    return {
      ids: [...(row?.tag_ids ?? [])].sort((a, b) => a - b),
      names: (row?.tags ?? []).map((t) => t.name).sort(),
    }
  }

  it('creates, lists, updates and deletes a rule', async () => {
    const tagId = await makeTag()
    const createRes = await tagRulesCreate({
      tag_id: tagId,
      name: 'AWS spend',
      criteria: { description: 'aws' },
      auto_apply: true,
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()

    const list = await (await tagRulesList()).json()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('AWS spend')
    expect(list[0].criteria.description).toBe('aws')
    expect(list[0].auto_apply).toBe(true)

    await tagRulesUpdate(
      { p1: String(created.id) },
      { name: 'Cloud spend', criteria: { description: 'aws' }, auto_apply: false }
    )
    const updated = await (await tagRulesList()).json()
    expect(updated[0].name).toBe('Cloud spend')
    expect(updated[0].auto_apply).toBe(false)

    expect((await tagRulesDelete({ p1: String(created.id) })).status).toBe(200)
    expect(await (await tagRulesList()).json()).toHaveLength(0)
  })

  it('rejects a rule pointing at a tag from another profile', async () => {
    const db = await getDB()
    await db.add('profiles', { id: 2, name: 'Other', created_at: '2026-01-01' })
    await db.add('tags', { id: 99, profile_id: 2, name: 'Foreign', color: '#fff' })

    const res = await tagRulesCreate({ tag_id: 99, criteria: { description: 'x' } })
    expect(res.status).toBe(404)
    expect(await (await tagRulesList()).json()).toHaveLength(0)
  })

  it('rejects a rule with no tag', async () => {
    expect((await tagRulesCreate({ criteria: { description: 'x' } })).status).toBe(400)
  })

  it('previews matches without writing anything', async () => {
    const tagId = await makeTag()
    await seedTransaction({ description: 'AWS invoice', category_id: 10 })
    await seedTransaction({ description: 'Groceries', category_id: 11 })

    const preview = await (
      await tagRulesPreview({ tag_id: tagId, criteria: { description: 'aws' } })
    ).json()
    expect(preview.matched).toBe(1)
    expect(preview.new_matches).toBe(1)
    expect(preview.already_tagged).toBe(0)
    expect(preview.sample[0].description).toBe('AWS invoice')

    // Nothing was tagged by the dry run.
    const rows = await (await transactionsList(EMPTY_QUERY)).json()
    expect(rows.every((r: { tags?: unknown[] }) => !r.tags?.length)).toBe(true)
  })

  it('applies an unsaved rule to existing transactions and is idempotent', async () => {
    const tagId = await makeTag()
    await seedTransaction({ description: 'AWS invoice' })
    await seedTransaction({ description: 'AWS support' })
    await seedTransaction({ description: 'Groceries' })

    const first = await (
      await tagsApplyRules({ p1: String(tagId) }, { criteria: { description: 'aws' } })
    ).json()
    expect(first.matched).toBe(2)
    expect(first.tagged).toBe(2)

    // Re-applying matches the same rows but tags nothing new.
    const second = await (
      await tagsApplyRules({ p1: String(tagId) }, { criteria: { description: 'aws' } })
    ).json()
    expect(second.matched).toBe(2)
    expect(second.tagged).toBe(0)

    const rows = await (await transactionsList(EMPTY_QUERY)).json()
    const tagged = rows.filter((r: { tags?: { id: number }[] }) =>
      r.tags?.some((t) => t.id === tagId)
    )
    expect(tagged).toHaveLength(2)
  })

  it('applies the tag’s saved rules to pre-existing transactions', async () => {
    const tagId = await makeTag()
    // History first, rule second — the whole point of "apply to previous transactions".
    await seedTransaction({ description: 'AWS invoice', category_id: 10 })
    await seedTransaction({ description: 'Groceries', category_id: 11 })
    await tagRulesCreate({ tag_id: tagId, criteria: { categoryIds: [10] } })

    const result = await (await tagsApplyRules({ p1: String(tagId) }, {})).json()
    expect(result.matched).toBe(1)
    expect(result.tagged).toBe(1)
  })

  it('narrows the scan by the structural conditions, like the Worker does', async () => {
    // Both runtimes examine at most TAG_RULE_SCAN_LIMIT rows, newest first. The Worker narrows
    // that scan in SQL BEFORE the limit, so a date-bounded rule scans the dated window rather than
    // the newest N rows overall. This runtime must narrow by the same conditions — otherwise, on a
    // ledger past the cap, the cloud would tag rows this runtime never looked at. `scanned` is the
    // observable: it counts candidates after narrowing, so it must not count the excluded rows.
    const tagId = await makeTag()
    await seedTransaction({ description: 'Old company spend', date: '2020-01-05' })
    await seedTransaction({ description: 'Company laptop', date: '2026-03-01' })
    await seedTransaction({ description: 'Company lunch', date: '2026-03-02' })

    const preview = await (
      await tagRulesPreview({
        tag_id: tagId,
        criteria: { description: 'company', dateFrom: '2026-01-01' },
      })
    ).json()
    // Matches the Worker exactly: 2 of 3 rows survive the date narrowing and both match.
    expect(preview.matched).toBe(2)
    expect(preview.scanned).toBe(2)

    // An OR rule cannot be narrowed by any single condition — the whole ledger stays in scope.
    const anyPreview = await (
      await tagRulesPreview({
        tag_id: tagId,
        criteria: { match: 'any', description: 'company', dateFrom: '2026-01-01' },
      })
    ).json()
    expect(anyPreview.scanned).toBe(3)
    expect(anyPreview.matched).toBe(3)
  })

  it('explains a 0-match rule by counting each condition separately', async () => {
    // The reported confusion: description clearly matches a transaction, yet the rule finds
    // nothing, because a category chip left selected ANDs the result to zero and nothing on
    // screen says so. The preview now reports per-condition counts.
    const tagId = await makeTag()
    await seedTransaction({ description: 'Feedbackqueue', category_id: 11 })

    const preview = await (
      await tagRulesPreview({
        tag_id: tagId,
        criteria: { description: 'Feedbackqueue', categoryIds: [10] },
      })
    ).json()

    expect(preview.matched).toBe(0)
    const byKey = Object.fromEntries(
      preview.conditions.map((c: { key: string; matched: number }) => [c.key, c.matched])
    )
    expect(byKey.description).toBe(1) // the text condition is fine on its own...
    expect(byKey.categories).toBe(0) // ...the category is what zeroes the rule
  })

  it('refuses to apply when the tag has no rules', async () => {
    const tagId = await makeTag()
    const res = await tagsApplyRules({ p1: String(tagId) }, {})
    expect(res.status).toBe(400)
  })

  it('never sweeps the ledger with an empty rule', async () => {
    const tagId = await makeTag()
    await seedTransaction({ description: 'AWS invoice' })
    await seedTransaction({ description: 'Groceries' })

    const preview = await (await tagRulesPreview({ tag_id: tagId, criteria: {} })).json()
    expect(preview.matched).toBe(0)

    const applied = await (await tagsApplyRules({ p1: String(tagId) }, { criteria: {} })).json()
    expect(applied.matched).toBe(0)
    expect(applied.tagged).toBe(0)
  })

  it('auto-applies rules to transactions created afterwards', async () => {
    const tagId = await makeTag()
    await tagRulesCreate({ tag_id: tagId, criteria: { description: 'aws' }, auto_apply: true })

    const res = await transactionsCreate({
      amount: 20,
      type: 'expense',
      date: '2026-04-01',
      description: 'AWS invoice',
    })
    const created = await res.json()
    expect(created.tags).toEqual([{ id: tagId, name: 'Company', color: '#6e9bff' }])

    const rows = await (await transactionsList(EMPTY_QUERY)).json()
    expect(rows[0].tags).toHaveLength(1)
  })

  it('does not auto-apply a rule with auto_apply off', async () => {
    const tagId = await makeTag()
    await tagRulesCreate({ tag_id: tagId, criteria: { description: 'aws' }, auto_apply: false })

    await seedTransaction({ description: 'AWS invoice' })
    const rows = await (await transactionsList(EMPTY_QUERY)).json()
    expect(rows[0].tags ?? []).toHaveLength(0)
  })

  it('deleting a tag removes its rules and untags its transactions', async () => {
    const tagId = await makeTag()
    await tagRulesCreate({ tag_id: tagId, criteria: { description: 'aws' } })
    await seedTransaction({ description: 'AWS invoice' })
    await tagsApplyRules({ p1: String(tagId) }, {})

    await tagsDelete({ p1: String(tagId) })

    expect(await (await tagRulesList()).json()).toHaveLength(0)
    const rows = await (await transactionsList(EMPTY_QUERY)).json()
    expect(rows[0].tags ?? []).toHaveLength(0)
    expect(rows[0].tag_ids ?? []).toHaveLength(0)
  })

  it('summarizes tags by type and honours the date window', async () => {
    const tagId = await makeTag()
    await tagRulesCreate({ tag_id: tagId, criteria: { description: 'company' } })
    await seedTransaction({ description: 'Company laptop', amount: 300, type: 'expense' })
    await seedTransaction({
      description: 'Company refund',
      amount: 120,
      type: 'income',
      date: '2026-04-02',
    })
    await tagsApplyRules({ p1: String(tagId) }, {})

    const all = await (await tagsSummary(EMPTY_QUERY)).json()
    expect(all).toHaveLength(1)
    expect(all[0].expense).toBe(300)
    expect(all[0].income).toBe(120)
    expect(all[0].net).toBe(-180)
    expect(all[0].count).toBe(2)
    expect(all[0].rule_count).toBe(1)

    const windowed = await (
      await tagsSummary(new URLSearchParams({ startDate: '2026-04-01', endDate: '2026-04-30' }))
    ).json()
    expect(windowed[0].count).toBe(1)
    expect(windowed[0].income).toBe(120)
    expect(windowed[0].expense).toBe(0)
  })

  it('returns a monthly series and category breakdown for one tag', async () => {
    const tagId = await makeTag()
    await seedTransaction({
      description: 'Company laptop',
      amount: 300,
      category_id: 10,
      date: '2026-03-15',
    })
    await seedTransaction({
      description: 'Company lunch',
      amount: 40,
      category_id: 11,
      date: '2026-04-02',
    })
    await tagsApplyRules({ p1: String(tagId) }, { criteria: { description: 'company' } })

    const detail = await (await tagSummary({ p1: String(tagId) }, EMPTY_QUERY)).json()
    expect(detail.tag.name).toBe('Company')
    expect(detail.totals.expense).toBe(340)
    expect(detail.monthly.map((m: { month: string }) => m.month)).toEqual(['2026-03', '2026-04'])
    expect(detail.monthly[0].expense).toBe(300)
    expect(detail.categories.map((c: { name: string }) => c.name)).toEqual(['Software', 'Food'])
  })

  it('404s the detail summary for a tag from another profile', async () => {
    const db = await getDB()
    await db.add('profiles', { id: 2, name: 'Other', created_at: '2026-01-01' })
    await db.add('tags', { id: 99, profile_id: 2, name: 'Foreign', color: '#fff' })
    expect((await tagSummary({ p1: '99' }, EMPTY_QUERY)).status).toBe(404)
    expect((await tagsApplyRules({ p1: '99' }, { criteria: { description: 'x' } })).status).toBe(
      404
    )
  })

  // ── Bulk tag / untag (selection-bar action) ────────────────────────────────
  // Same assertions as worker/test/tag-rules.test.ts, since both share the endpoint contract.

  it('bulk-adds a tag additively and idempotently', async () => {
    const company = await makeTag('Company')
    const travel = await makeTag('Travel')
    const t1 = await seedTransaction({ description: 'A' })
    const t2 = await seedTransaction({ description: 'B' })
    const t3 = await seedTransaction({ description: 'C' })
    // Pre-tag t1 with Travel to prove the add is additive, not a replace.
    await tagsBulkTagTransactions({ p1: String(travel) }, { transactionIds: [t1], mode: 'add' })

    const res = await tagsBulkTagTransactions(
      { p1: String(company) },
      { transactionIds: [t1, t2], mode: 'add' }
    )
    expect(await res.json()).toMatchObject({ ok: true, mode: 'add', matched: 2, added: 2 })

    expect((await tagsOf(t1)).ids).toEqual([company, travel].sort((a, b) => a - b))
    expect((await tagsOf(t1)).names).toEqual(['Company', 'Travel'])
    expect((await tagsOf(t2)).ids).toEqual([company])
    expect((await tagsOf(t3)).ids).toEqual([])

    // Re-running links nothing new.
    const again = await tagsBulkTagTransactions(
      { p1: String(company) },
      { transactionIds: [t1, t2], mode: 'add' }
    )
    expect((await again.json()).added).toBe(0)
  })

  it('bulk-removes only the given tag, leaving other tags intact', async () => {
    const company = await makeTag('Company')
    const travel = await makeTag('Travel')
    const t1 = await seedTransaction({ description: 'A' })
    const t2 = await seedTransaction({ description: 'B' })
    await tagsBulkTagTransactions(
      { p1: String(company) },
      { transactionIds: [t1, t2], mode: 'add' }
    )
    await tagsBulkTagTransactions({ p1: String(travel) }, { transactionIds: [t1], mode: 'add' })

    const res = await tagsBulkTagTransactions(
      { p1: String(company) },
      { transactionIds: [t1, t2], mode: 'remove' }
    )
    expect(await res.json()).toMatchObject({ ok: true, mode: 'remove', matched: 2, removed: 2 })
    expect((await tagsOf(t1)).names).toEqual(['Travel'])
    expect((await tagsOf(t2)).ids).toEqual([])
  })

  it('never tags a transaction from another profile', async () => {
    const db = await getDB()
    await db.add('profiles', { id: 2, name: 'Other', created_at: '2026-01-01' })
    const foreignId = 9999
    await db.add('transactions', {
      id: foreignId,
      profile_id: 2,
      amount: 100,
      type: 'expense',
      date: '2026-03-15',
      description: 'Foreign',
    })
    const company = await makeTag('Company')
    const res = await tagsBulkTagTransactions(
      { p1: String(company) },
      { transactionIds: [foreignId], mode: 'add' }
    )
    expect(await res.json()).toMatchObject({ ok: true, matched: 0, added: 0 })
    const foreign = (await db.get('transactions', foreignId)) as { tag_ids?: number[] }
    expect(foreign.tag_ids ?? []).toEqual([])
  })

  it('404s bulk tagging with a tag from another profile', async () => {
    const db = await getDB()
    await db.add('profiles', { id: 2, name: 'Other', created_at: '2026-01-01' })
    await db.add('tags', { id: 99, profile_id: 2, name: 'Foreign', color: '#fff' })
    const t1 = await seedTransaction({ description: 'A' })
    expect(
      (await tagsBulkTagTransactions({ p1: '99' }, { transactionIds: [t1], mode: 'add' })).status
    ).toBe(404)
  })

  it('rejects an empty transaction id list', async () => {
    const company = await makeTag('Company')
    const res = await tagsBulkTagTransactions(
      { p1: String(company) },
      { transactionIds: [], mode: 'add' }
    )
    expect(res.status).toBe(400)
  })
})
