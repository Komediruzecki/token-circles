/**
 * Transactions handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, notFound, ok } from './helpers'
import { normalizeTransaction } from './normalize'

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

  // Enrich transactions with category name/color (like the backend SQL JOIN)
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const enriched = txns.map((t) => {
    const cat = catMap.get(t.category_id)
    return normalizeTransaction({
      ...t,
      category_name: cat?.name || null,
      category_color: cat?.color || null,
    })
  })

  return json(enriched)
}

export async function transactionsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid transaction data' }, 400)
  const tx = body as Record<string, unknown>
  tx.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createTransaction(
    tx as unknown as Parameters<typeof adapter.createTransaction>[0]
  )
  return json({ id, ...tx }, 201)
}

export async function transactionsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const txn = await db.get('transactions', idParam(params))
  if (!txn) return notFound('Transaction')
  return json(txn)
}

export async function transactionsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateTransaction(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function transactionsDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteTransaction(idParam(params))
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
  const csv = ['date,type,description,amount,currency,category_id,notes']
  for (const t of txns) {
    csv.push(
      [
        t.date,
        t.type,
        `"${t.description}"`,
        t.amount,
        t.currency || 'EUR',
        t.category_id || '',
        `"${t.notes || ''}"`,
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
  if (!txn) return notFound('Transaction')
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
              if (!['income', 'expense', 'transfer'].includes(t)) continue
              patch.type = t
            } else {
              patch[field] = updateData[field]
            }
          }
        }
        if (Object.keys(patch).length > 0) {
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
  const now = new Date().toISOString()
  let updated = 0
  for (const id of ids) {
    const txn = await db.get('transactions', id)
    if (txn && !txn.reconciled) {
      txn.reconciled = 1
      txn.reconciled_at = now
      await db.put('transactions', txn)
      updated++
    }
  }
  return json({ message: `${updated} transactions reconciled`, updated })
}
