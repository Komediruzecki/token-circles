/**
 * Accounts handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, idParam, json, notFound, ok } from './helpers'

export async function accountsList(): Promise<Response> {
  const accts = await adapter.listAccounts()
  return json(accts)
}

export async function accountsCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid account data' }, 400)
  const acct = body as Record<string, unknown>
  acct.profile_id = await adapter.getCurrentProfileId()
  const id = await adapter.createAccount(
    acct as unknown as Parameters<typeof adapter.createAccount>[0]
  )
  return json({ id, ...acct }, 201)
}

export async function accountsGet(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const acct = await db.get('accounts', idParam(params))
  if (!acct) return notFound('Account')
  return json(acct)
}

export async function accountsUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  await adapter.updateAccount(idParam(params), body as Record<string, unknown>)
  return ok()
}

export async function accountsDelete(params: Record<string, string>): Promise<Response> {
  await adapter.deleteAccount(idParam(params))
  return ok()
}

export async function accountsHistory(params: Record<string, string>): Promise<Response> {
  const history = await adapter.getBalanceHistory(idParam(params))
  return json(history)
}

export async function accountsHistoryRecord(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const balance = (body as Record<string, unknown>).balance as number
  if (typeof balance !== 'number') return json({ error: 'Balance required' }, 400)
  const id = await adapter.recordBalance(idParam(params), balance)
  return json({ id, account_id: idParam(params), balance, date: new Date().toISOString() }, 201)
}

export async function accountsHistoryDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  await db.delete('balanceHistory', idParam(params, 'p2'))
  return ok()
}

export async function accountsTimeline(): Promise<Response> {
  try {
    const db = await getDB()
    const pids = adapter.getCurrentProfileIds()
    const allHistory = await db.getAll('balanceHistory')
    const timeline = new Map<string, number>()
    for (const entry of allHistory as Record<string, unknown>[]) {
      const accountId = entry.account_id as number
      try {
        const acct = await db.get('accounts', accountId)
        if (!acct || !pids.includes(acct.profile_id)) continue
      } catch {
        continue
      }
      const date = ((entry.recorded_at as string) || (entry.date as string) || '').slice(0, 10)
      const balance = entry.balance as number
      timeline.set(date, (timeline.get(date) || 0) + balance)
    }
    const result = Array.from(timeline.entries())
      .map(([date, netWorth]) => ({ date, net_worth: netWorth }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return json(result)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function accountsReconciliationSummary(
  params: Record<string, string>
): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const accountId = idParam(params)
    const account = await db.get('accounts', accountId)
    if (!account || account.profile_id !== pid) return notFound('Account')

    const allTxns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    const txns = (allTxns as Record<string, unknown>[]).filter((t) => t.account_id === accountId)

    const unreconciled = txns.filter((t) => !t.reconciled)
    const reconciled = txns.filter((t) => !!t.reconciled)

    return json({
      account_id: accountId,
      account_name: account.name,
      unreconciled_count: unreconciled.length,
      unreconciled_total: unreconciled.reduce((s, t) => s + ((t.amount as number) || 0), 0),
      reconciled_count: reconciled.length,
      total_transactions: txns.length,
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
