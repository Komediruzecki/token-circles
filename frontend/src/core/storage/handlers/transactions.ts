/**
 * Transactions handlers — IndexedDB-backed implementations
 */
import { transactionInvariantError } from '../../../../../shared/transactionInvariant'
import {
  checkTransactionCreate,
  checkTransactionEdit,
  TRANSACTION_MESSAGES,
} from '../../../../../shared/transactionSchema'
import { localTransactionDefaults } from '../../validation'
import { getDB } from '../idb'
import { recalcGoalsByCategory } from './goals'
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
  writeProfileIdFromHeaders,
} from './helpers'
import { normalizeTransaction } from './normalize'
import { autoApplyTagRules } from './tagRules'
import type { FieldErrors } from '../../../../../shared/refusal'

const toCat = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v ? Number(v) : null

export async function transactionsList(query: URLSearchParams): Promise<Response> {
  const filters: Record<string, unknown> = {}
  const df = query.get('date_from')
  const dt = query.get('date_to')
  const cat = query.get('category_id')
  const type = query.get('type')
  const search = query.get('search')
  if (df) filters.date_from = df
  if (dt) filters.date_to = dt
  if (cat) filters.category_id = parseInt(cat, 10)
  if (type) filters.type = type
  if (search) filters.search = search
  const txns = await adapter.listTransactions(
    filters as Parameters<typeof adapter.listTransactions>[0]
  )

  // Enrich transactions with category name/color and receipt id/name (like the
  // backend SQL JOINs) so the table can render the category cell and receipt chip.
  const db = await getDB()
  // In household view the rows come from every selected profile, and each is enriched from its
  // own, as the Worker's joins do (`c.profile_id = t.profile_id`). Looking categories, receipts
  // and tags up in the active profile's alone left every other profile's rows with none.
  const pids = adapter.getCurrentProfileIds()
  const cats = (
    await Promise.all(pids.map((p) => db.getAllFromIndex('categories', 'by_profile', p)))
  ).flat()
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const receipts = (
    await Promise.all(pids.map((p) => db.getAllFromIndex('receipts', 'by_profile', p)))
  ).flat()
  const receiptKey = (profileId: unknown, transactionId: unknown) => `${profileId}:${transactionId}`
  const receiptByTx = new Map(
    receipts
      .filter((r) => typeof r.transaction_id === 'number')
      .map((r) => [receiptKey(r.profile_id, r.transaction_id), r])
  )
  // Resolve tags from `tag_ids` rather than trusting each row's denormalized `tags` copy, so a
  // renamed or recolored tag renders correctly everywhere without a data migration. Rows written
  // before tag_ids existed fall back to whatever copy they carry.
  const tagRows = (
    await Promise.all(pids.map((p) => db.getAllFromIndex('tags', 'by_profile', p)))
  ).flat() as Record<string, any>[]
  const tagMap = new Map(tagRows.map((tag) => [tag.id as number, tag]))
  const enriched = txns.map((t) => {
    const linked = catMap.get(t.category_id)
    const cat = linked?.profile_id === t.profile_id ? linked : undefined
    const receipt = receiptByTx.get(receiptKey(t.profile_id, t.id))
    const tagIds = t.tag_ids as number[] | undefined
    const tags = Array.isArray(tagIds)
      ? tagIds
          .map((tagId) => tagMap.get(tagId))
          .filter((tag): tag is Record<string, any> => Boolean(tag))
          .map((tag) => ({ id: tag.id as number, name: tag.name, color: tag.color }))
      : t.tags
    return normalizeTransaction({
      ...t,
      tags,
      category_name: cat?.name || null,
      category_color: cat?.color || null,
      receipt_id: receipt?.id ?? null,
      receipt_name: receipt?.original_name ?? null,
    })
  })

  return json(enriched)
}

/**
 * Links to another profile's account or category, each at its field, as the Worker refuses them.
 * Only the links given are checked (a link left out or cleared is no link): an edit passes the
 * ones it changes.
 */
async function foreignLinks(
  links: { account_id?: unknown; transfer_account_id?: unknown; category_id?: unknown },
  profileId: number
): Promise<FieldErrors> {
  const fields: FieldErrors = {}
  if (!(await currentProfileOwns('accounts', links.account_id, profileId))) {
    fields.account_id = TRANSACTION_MESSAGES.account
  }
  if (!(await currentProfileOwns('accounts', links.transfer_account_id, profileId))) {
    fields.transfer_account_id = TRANSACTION_MESSAGES.account
  }
  if (!(await currentProfileOwns('categories', links.category_id, profileId))) {
    fields.category_id = TRANSACTION_MESSAGES.category
  }
  return fields
}

export async function transactionsCreate(body: unknown, headers?: HeadersInit): Promise<Response> {
  // The Worker's rules and words (shared/transactionSchema.ts). The router has already run this
  // check on the way in; a direct call (tests, other handlers) gets the same answer.
  const checked = checkTransactionCreate(body, localTransactionDefaults())
  if (!checked.ok) return refuse(checked.fields)
  const profileId = await writeProfileIdFromHeaders(headers)
  const foreign = await foreignLinks(checked.value, profileId)
  if (Object.keys(foreign).length > 0) return refuse(foreign)
  // The row the Worker stores, not the body as it came: every field the read schema needs, with
  // its default, and nothing the body made up.
  const now = new Date().toISOString()
  const tx: Record<string, unknown> = {
    ...checked.value,
    profile_id: profileId,
    created_at: now,
    updated_at: now,
  }
  const id = await adapter.createTransaction(
    tx as unknown as Parameters<typeof adapter.createTransaction>[0]
  )
  // Apply auto-apply tag rules to the new row (mirrors the Worker's create path). Fail-soft
  // inside the helper — the transaction is already stored, so tagging must never fail the create.
  const autoTags = await autoApplyTagRules(id, profileId)
  await recalcGoalsByCategory(toCat(tx.category_id))
  // Normalize like the list endpoint: the client validates this response against the
  // full TransactionSchema.
  return json(
    normalizeTransaction({ id, ...tx, ...(autoTags.length ? { tags: autoTags } : {}) }),
    201
  )
}

export async function transactionsGet(params: Record<string, string>): Promise<Response> {
  const txn = await currentProfileRecord('transactions', idParam(params))
  if (!txn) return notFound('Transaction')
  return json(normalizeTransaction(txn))
}

export async function transactionsUpdate(
  params: Record<string, string>,
  body: unknown,
  headers?: HeadersInit
): Promise<Response> {
  const id = idParam(params)
  const profileId = await writeProfileIdFromHeaders(headers)
  const before = await currentProfileRecord('transactions', id, profileId)
  if (!before) return notFound('Transaction')
  // Only the fields the body changes, checked as the Worker checks them (shared/
  // transactionSchema.ts). The Transactions form sends every field on every save: a field sent
  // back with the value the row holds is neither checked nor written, so a row saved under older
  // rules can still be edited. An edit that changes how the row moves money is checked against
  // the whole row it leaves behind, as the balances are reversed and applied again from it.
  const checked = checkTransactionEdit(body, before, localTransactionDefaults())
  if (!checked.ok) {
    // The router logs this for every body its checks refuse, and the release suite fails a
    // local-first run that shows one (tests/release/release-fixtures.ts). An edit is checked here,
    // against the stored row, so it is said here.
    console.error('[transactionsUpdate] Validation failed', { id, body, fields: checked.fields })
    return refuse(checked.fields)
  }
  const patch = checked.value
  const foreign = await foreignLinks(patch, profileId)
  if (Object.keys(foreign).length > 0) return refuse(foreign)
  // Nothing to change: a save that changed only the tags, which go in a request of their own.
  if (Object.keys(patch).length === 0) return ok()
  await adapter.updateTransaction(id, patch as Parameters<typeof adapter.updateTransaction>[1])
  // Recompute both the previous and new category (an edit may re-categorize the tx).
  const oldCat = toCat(before.category_id)
  const newCat = patch.category_id !== undefined ? patch.category_id : oldCat
  await recalcGoalsByCategory(oldCat)
  if (newCat !== oldCat) await recalcGoalsByCategory(newCat)
  return ok()
}

export async function transactionsDelete(
  params: Record<string, string>,
  headers?: HeadersInit
): Promise<Response> {
  const id = idParam(params)
  const profileId = await writeProfileIdFromHeaders(headers)
  const before = await currentProfileRecord('transactions', id, profileId)
  if (!before) return notFound('Transaction')
  await adapter.deleteTransaction(id)
  await recalcGoalsByCategory(toCat(before?.category_id))
  return ok()
}

export async function transactionsExport(query: URLSearchParams): Promise<Response> {
  const filters: Record<string, unknown> = {}
  const df = query.get('date_from')
  const dt = query.get('date_to')
  if (df) filters.date_from = df
  if (dt) filters.date_to = dt
  const txns = await adapter.listTransactions(
    filters as Parameters<typeof adapter.listTransactions>[0] | undefined
  )
  const csvQuote = (s: string | null | undefined): string => `"${(s ?? '').replace(/"/g, '""')}"`
  const csv = ['date,type,description,amount,currency,category_id,notes']
  for (const t of txns) {
    csv.push(
      [
        t.date,
        t.type,
        csvQuote(t.description),
        t.amount,
        t.currency || 'EUR',
        t.category_id || '',
        csvQuote(t.notes),
      ].join(',')
    )
  }
  return new Response(csv.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=transactions.csv',
    },
  })
}

export async function transactionsSummary(): Promise<Response> {
  const txns = await adapter.listTransactions()
  const totalIncome = txns
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
  const totalExpenses = txns
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + getAmount(t as unknown as Record<string, unknown>), 0)
  return json({ totalIncome, totalExpenses, count: txns.length })
}

// ── Reconciliation ───────────────────────────────────────────────────────────

export async function reconcileToggle(
  params: Record<string, string>,
  headers?: HeadersInit
): Promise<Response> {
  const db = await getDB()
  const profileId = await writeProfileIdFromHeaders(headers)
  const txn = await currentProfileRecord('transactions', idParam(params), profileId)
  if (!txn) return notFound('Transaction')
  const now = new Date().toISOString()
  txn.reconciled = txn.reconciled ? 0 : 1
  txn.reconciled_at = txn.reconciled ? now : null
  await db.put('transactions', txn)
  return json({ reconciled: txn.reconciled, reconciled_at: txn.reconciled_at })
}

export async function reconcileBulk(body: unknown, headers?: HeadersInit): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const { date_from, date_to } = body as Record<string, unknown>
  const txns = await adapter.listTransactions({
    date_from: date_from as string | undefined,
    date_to: date_to as string | undefined,
  })
  const db = await getDB()
  const pid = await writeProfileIdFromHeaders(headers)
  const now = new Date().toISOString()
  let count = 0
  for (const t of txns) {
    if (t.profile_id !== pid) continue
    if (!t.reconciled) {
      t.reconciled = 1
      t.reconciled_at = now
      await db.put('transactions', t)
      count++
    }
  }
  return json({ message: `${count} transactions reconciled`, count })
}

export async function reconcileSummary(): Promise<Response> {
  const txns = await adapter.listTransactions()
  const reconciled = txns.filter((t) => t.reconciled)
  const unreconciled = txns.filter((t) => !t.reconciled)
  return json({
    reconciled_count: reconciled.length,
    unreconciled_count: unreconciled.length,
    reconciled_total: reconciled.reduce(
      (s, t) => s + getAmount(t as unknown as Record<string, unknown>),
      0
    ),
    unreconciled_total: unreconciled.reduce(
      (s, t) => s + getAmount(t as unknown as Record<string, unknown>),
      0
    ),
  })
}

export async function transactionsBulk(body: unknown, headers?: HeadersInit): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await writeProfileIdFromHeaders(headers)
    const data = body as Record<string, unknown>
    const ids = (data.ids || data.transactionIds) as number[] | undefined
    const action = ((data.action || data._method || 'update') as string).toLowerCase()
    const updateData = (data.data || data) as Record<string, unknown>

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return json({ error: 'No transaction IDs provided' }, 400)
    }
    if (ids.length > 1000) {
      return json({ error: 'Cannot update more than 1000 transactions at once' }, 400)
    }

    if (action === 'delete') {
      // Ownership first, then ONE IndexedDB write transaction for the whole batch. The
      // per-id loop this replaces opened a readwrite transaction per row and reapplied the
      // account-balance deltas each time, so deleting a full page cost 50 of them on the
      // main thread — the "deleting is slow" report. bulkDeleteTransactions does not filter
      // by profile, which is why the ownership pass stays.
      // Deduplicated: the loop this replaces re-read each id AFTER the previous delete had
      // committed, so a repeated id read back undefined and was skipped. Checking ownership
      // up front instead would otherwise count the same row twice.
      const owned: number[] = []
      for (const id of new Set(ids)) {
        const tx = await db.get('transactions', id)
        if (tx && tx.profile_id === pid) owned.push(id)
      }
      if (owned.length > 0) await adapter.bulkDeleteTransactions(owned)
      return json({ ok: true, deleted: owned.length })
    }

    if (action === 'update') {
      if (!updateData || typeof updateData !== 'object') {
        return json({ error: 'No update data provided' }, 400)
      }
      // Category ownership is the same for the whole batch — check it once, before any write.
      if (
        'category_id' in updateData &&
        !(await currentProfileOwns('categories', updateData.category_id, pid))
      ) {
        return json({ error: 'Category does not belong to this profile' }, 400)
      }
      const allowedFields = [
        'category_id',
        'type',
        'description',
        'beneficiary',
        'payor',
        'notes',
        'reconciled',
      ]
      // Pass 1 — validate every affected row against the shared invariant and stage its patch.
      // The bulk is all-or-nothing: one invariant-violating row (e.g. a legacy malformed row
      // swept into the selection) rejects the WHOLE request before any write, so we never
      // partially apply and leave earlier rows mutated (audit H-02). Mirrors the Worker bulk
      // path and the single-update handler, which validate the resulting row too.
      const staged: { id: number; patch: Record<string, unknown> }[] = []
      for (const id of ids) {
        const tx = await db.get('transactions', id)
        if (!tx || tx.profile_id !== pid) continue
        const patch: Record<string, unknown> = {}
        for (const field of allowedFields) {
          if (field in updateData) {
            if (field === 'reconciled') {
              patch.reconciled = updateData.reconciled ? 1 : 0
            } else if (field === 'type') {
              const t = updateData.type as string
              if (t === 'transfer') {
                return json(
                  { error: 'Bulk conversion to transfer requires choosing two accounts' },
                  400
                )
              }
              if (!['income', 'expense', 'deduction'].includes(t)) continue
              patch.type = t
            } else {
              patch[field] = updateData[field]
            }
          }
        }
        if (Object.keys(patch).length > 0) {
          if (patch.type !== undefined && tx.type === 'transfer') {
            patch.transfer_account_id = null
          }
          const invariantError = transactionInvariantError({ ...tx, ...patch })
          if (invariantError) return json({ error: invariantError }, 400)
          staged.push({ id, patch })
        }
      }
      // Pass 2 — every staged row passed validation, so apply them.
      let updated = 0
      for (const { id, patch } of staged) {
        await adapter.updateTransaction(id, patch)
        updated++
      }
      return json({ ok: true, updated })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function reconcileBatch(body: unknown, headers?: HeadersInit): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const ids = (body as Record<string, unknown>).transaction_ids as number[]
  if (!Array.isArray(ids)) return json({ error: 'transaction_ids array required' }, 400)
  const db = await getDB()
  const pid = await writeProfileIdFromHeaders(headers)
  const now = new Date().toISOString()
  let updated = 0
  for (const id of ids) {
    const txn = await db.get('transactions', id)
    if (txn && txn.profile_id === pid && !txn.reconciled) {
      txn.reconciled = 1
      txn.reconciled_at = now
      await db.put('transactions', txn)
      updated++
    }
  }
  return json({ message: `${updated} transactions reconciled`, updated })
}
