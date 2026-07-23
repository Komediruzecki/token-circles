/**
 * Transactions handlers — IndexedDB-backed implementations
 */
import { transactionInvariantError } from '../../../../../shared/transactionInvariant'
import { getDB } from '../idb'
import { recalcGoalsByCategory } from './goals'
import { adapter, idParam, json, notFound, ok } from './helpers'
import { normalizeTransaction } from './normalize'

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
  const pid = await adapter.getCurrentProfileId()
  const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const receipts = await db.getAllFromIndex('receipts', 'by_profile', pid)
  const receiptByTx = new Map(
    receipts.filter((r) => typeof r.transaction_id === 'number').map((r) => [r.transaction_id, r])
  )
  const enriched = txns.map((t) => {
    const cat = catMap.get(t.category_id)
    const receipt = receiptByTx.get(t.id)
    return normalizeTransaction({
      ...t,
      category_name: cat?.name || null,
      category_color: cat?.color || null,
      receipt_id: receipt?.id ?? null,
      receipt_name: receipt?.original_name ?? null,
    })
  })

  return json(enriched)
}

export async function transactionsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid transaction data' }, 400)
  const tx = { ...(body as Record<string, unknown>) }
  tx.profile_id = await adapter.getCurrentProfileId()
  const invariantError = transactionInvariantError({
    type: tx.type,
    amount: tx.amount,
    amount_local: tx.amount_local,
    account_id: tx.account_id,
    transfer_account_id: tx.transfer_account_id,
  })
  if (invariantError) return json({ error: invariantError }, 400)
  const id = await adapter.createTransaction(
    tx as unknown as Parameters<typeof adapter.createTransaction>[0]
  )
  await recalcGoalsByCategory(toCat(tx.category_id))
  // Normalize like the list endpoint: the client validates this response against the
  // full TransactionSchema, and callers omit optional fields (beneficiary, notes, ...).
  return json(normalizeTransaction({ id, ...tx }), 201)
}

export async function transactionsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const txn = await db.get('transactions', idParam(params))
  if (!txn) return notFound('Transaction')
  return json(normalizeTransaction(txn))
}

export async function transactionsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const id = idParam(params)
  const db = await getDB()
  const before = await db.get('transactions', id)
  // Only act on a row belonging to a selected profile (audit B2) — mirrors the bulk guard.
  if (before && !adapter.getCurrentProfileIds().includes(before.profile_id)) {
    return notFound('Transaction')
  }
  // A transfer must keep a destination account across the edit (audit D2). Check the
  // merged old+new state so a partial update that flips type to transfer, or clears the
  // destination, is rejected rather than silently producing an inert/unbalanced row.
  const patch = body as Record<string, unknown>
  if (!before) return notFound('Transaction')
  const normalizedPatch = { ...patch }
  const mergedType = 'type' in patch ? patch.type : before.type
  if (
    mergedType !== 'transfer' &&
    before.type === 'transfer' &&
    !('transfer_account_id' in patch)
  ) {
    normalizedPatch.transfer_account_id = null
  }
  const merged = { ...before, ...normalizedPatch }
  const invariantError = transactionInvariantError(merged)
  if (invariantError) return json({ error: invariantError }, 400)
  await adapter.updateTransaction(id, normalizedPatch)
  // Recompute both the previous and new category (an edit may re-categorize the tx).
  const oldCat = toCat(before?.category_id)
  const newCat = toCat(normalizedPatch.category_id) ?? oldCat
  await recalcGoalsByCategory(oldCat)
  if (newCat !== oldCat) await recalcGoalsByCategory(newCat)
  return ok()
}

export async function transactionsDelete(params: Record<string, string>): Promise<Response> {
  const id = idParam(params)
  const db = await getDB()
  const before = await db.get('transactions', id)
  // Only delete a row belonging to a selected profile (audit B2).
  if (before && !adapter.getCurrentProfileIds().includes(before.profile_id)) {
    return notFound('Transaction')
  }
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
  const totalIncome = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const totalExpenses = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  return json({ totalIncome, totalExpenses, count: txns.length })
}

// ── Reconciliation ───────────────────────────────────────────────────────────

export async function reconcileToggle(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const txn = await db.get('transactions', idParam(params))
  // Treat a row outside the selected profiles as not found (audit B2).
  if (!txn || !adapter.getCurrentProfileIds().includes(txn.profile_id))
    return notFound('Transaction')
  const now = new Date().toISOString()
  txn.reconciled = txn.reconciled ? 0 : 1
  txn.reconciled_at = txn.reconciled ? now : null
  await db.put('transactions', txn)
  return json({ reconciled: txn.reconciled, reconciled_at: txn.reconciled_at })
}

export async function reconcileBulk(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const { date_from, date_to } = body as Record<string, unknown>
  const txns = await adapter.listTransactions({
    date_from: date_from as string | undefined,
    date_to: date_to as string | undefined,
  })
  const db = await getDB()
  const now = new Date().toISOString()
  let count = 0
  for (const t of txns) {
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
    reconciled_total: reconciled.reduce((s, t) => s + t.amount, 0),
    unreconciled_total: unreconciled.reduce((s, t) => s + t.amount, 0),
  })
}

export async function transactionsBulk(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pids = adapter.getCurrentProfileIds()
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
      let deleted = 0
      for (const id of ids) {
        const tx = await db.get('transactions', id)
        if (tx && pids.includes(tx.profile_id)) {
          await adapter.deleteTransaction(id)
          deleted++
        }
      }
      return json({ ok: true, deleted })
    }

    if (action === 'update') {
      if (!updateData || typeof updateData !== 'object') {
        return json({ error: 'No update data provided' }, 400)
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
      let updated = 0
      for (const id of ids) {
        const tx = await db.get('transactions', id)
        if (!tx || !pids.includes(tx.profile_id)) continue
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
          await adapter.updateTransaction(id, patch)
          updated++
        }
      }
      return json({ ok: true, updated })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function reconcileBatch(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const ids = (body as Record<string, unknown>).transaction_ids as number[]
  if (!Array.isArray(ids)) return json({ error: 'transaction_ids array required' }, 400)
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  const now = new Date().toISOString()
  let updated = 0
  for (const id of ids) {
    const txn = await db.get('transactions', id)
    // Skip rows outside the selected profiles (audit B2).
    if (txn && pids.includes(txn.profile_id) && !txn.reconciled) {
      txn.reconciled = 1
      txn.reconciled_at = now
      await db.put('transactions', txn)
      updated++
    }
  }
  return json({ message: `${updated} transactions reconciled`, updated })
}
