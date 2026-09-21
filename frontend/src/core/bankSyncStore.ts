import { createSignal } from 'solid-js'
import { toast } from './api'
import { apiFetch } from './apiFetch'

// A global lock to prevent double syncs
const [isSyncing, setIsSyncing] = createSignal(false)

export { isSyncing }

export async function triggerBankSync(force = false): Promise<void> {
  if (isSyncing()) return

  // Prevent spamming the API on every dashboard reload unless forced.
  // We'll use a 4 hour threshold for background app-open syncs.
  const THROTTLE_MS = 4 * 60 * 60 * 1000
  const lastSyncKey = 'lastBankSyncTime'
  const lastSyncStr = localStorage.getItem(lastSyncKey)

  if (!force && lastSyncStr) {
    const lastSyncTime = parseInt(lastSyncStr, 10)
    if (!isNaN(lastSyncTime) && Date.now() - lastSyncTime < THROTTLE_MS) {
      // It hasn't been 4 hours yet, silent abort
      return
    }
  }

  // Check if they even have a session before attempting to sync.
  try {
    const sessionRes = await apiFetch('/api/imports/enablebanking/session')
    if (!sessionRes.ok) return // No active session, quietly abort
    const sessionData = await sessionRes.json()
    if (!sessionData || !sessionData.connected) return
  } catch {
    return
  }

  setIsSyncing(true)
  try {
    // 1. Fetch Enable Banking payload
    const res = await apiFetch('/api/imports/enablebanking/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json()
    if (!res.ok || !data.success) {
      if (force) toast(`Bank sync failed: ${data.error || 'Unknown error'}`, 'error')
      return
    }

    const ebAccounts = data.accounts || []

    // Find the oldest date among the incoming transactions to scope our deduplication fetch
    let oldestDate = new Date().toISOString().split('T')[0]
    for (const ebAcc of ebAccounts) {
      for (const raw of ebAcc.transactions || []) {
        const d = raw.booking_date || raw.value_date || raw.date
        if (d && d < oldestDate) oldestDate = d.split('T')[0]
      }
    }

    // 2. Fetch existing transactions for dedup from the oldest date forward
    const existRes = await apiFetch(`/api/transactions?startDate=${oldestDate}&limit=10000`)
    const existData = await existRes.json()
    const existArr = Array.isArray(existData)
      ? existData
      : existData.rows || existData.items || existData.transactions || []

    // Extract previously synced TX IDs from notes so user edits to notes don't break dedup
    const existingTxIds = new Set(
      existArr.flatMap((t: any) => {
        const match = (t.notes || '').match(/Bank TX ID:\s*([^\s]+)/)
        return match ? [match[1]] : []
      })
    )

    // 3. Fetch accounts for fallback
    const accountsRes = await apiFetch('/api/accounts')
    const accountsData = await accountsRes.json()
    const accountsArr = Array.isArray(accountsData)
      ? accountsData
      : accountsData.items || accountsData.accounts || []
    const defaultAccount =
      accountsArr.find((a: any) => a.type === 'giro' || a.type === 'CHECKING') || accountsArr[0]

    // 4. Fetch category mappings for auto-categorization
    let categoryMappings: any[] = []
    try {
      const mapRes = await apiFetch('/api/categories/mappings')
      categoryMappings = await mapRes.json()
      if (!Array.isArray(categoryMappings)) categoryMappings = []
    } catch (_e) {
      // ignore
    }

    const findMatchingCategory = (desc: string) => {
      const lower = desc.toLowerCase().trim()
      return categoryMappings.find((m: any) => m.pattern.toLowerCase() === lower)
    }

    let newCount = 0
    const payloads: any[] = []

    for (const ebAcc of ebAccounts) {
      const accountId = ebAcc.mapped_account_id || (defaultAccount ? defaultAccount.id : null)
      const rawTxs = ebAcc.transactions || []

      for (const raw of rawTxs) {
        const txId = raw.transaction_id || raw.entry_reference || raw.id || ''
        if (!txId || existingTxIds.has(txId)) continue
        const notes = `Bank TX ID: ${txId}`

        const isDebit =
          raw.credit_debit_indicator === 'DBIT' ||
          (raw.transaction_amount?.amount && parseFloat(raw.transaction_amount.amount) < 0)
        const amtStr = raw.transaction_amount?.amount || String(raw.amount || 0)
        const amount = Math.abs(parseFloat(amtStr))
        const currency = raw.transaction_amount?.currency || raw.currency || 'EUR'
        const date =
          raw.booking_date || raw.value_date || raw.date || new Date().toISOString().split('T')[0]

        let description = 'Bank Sync'
        if (Array.isArray(raw.remittance_information) && raw.remittance_information.length > 0) {
          description = raw.remittance_information.join(' ')
        } else if (raw.remittance_information_unstructured) {
          description = raw.remittance_information_unstructured
        } else if (raw.creditor?.name) {
          description = raw.creditor.name
        } else if (raw.debtor?.name) {
          description = raw.debtor.name
        }

        const mapping = findMatchingCategory(description)

        payloads.push({
          description: description.substring(0, 100),
          amount: amount,
          type: isDebit ? 'expense' : 'income',
          date: date,
          currency: currency,
          beneficiary: isDebit && raw.creditor?.name ? raw.creditor.name : raw.creditor_name || '',
          payor: !isDebit && raw.debtor?.name ? raw.debtor.name : raw.debtor_name || '',
          notes: notes,
          exchange_rate: 1.0,
          account_id: accountId,
          category_id: mapping ? mapping.category_id : null,
        })
      }
    }

    // 5. Insert transactions in parallel chunks to avoid blocking the UI
    const chunkSize = 15
    for (let i = 0; i < payloads.length; i += chunkSize) {
      const chunk = payloads.slice(i, i + chunkSize)
      await Promise.all(
        chunk.map((txPayload) =>
          apiFetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(txPayload),
          })
        )
      )
      newCount += chunk.length
    }

    // Update last sync time
    localStorage.setItem(lastSyncKey, Date.now().toString())

    if (force) {
      toast(`Synced ${newCount} new transactions.`, 'success')
    } else if (newCount > 0) {
      toast(`Bank Sync: Found ${newCount} new transactions in the background.`, 'success')
    }
  } catch (e: any) {
    if (force) {
      toast(`Failed to sync bank data: ${e.message}`, 'error')
    }
  } finally {
    setIsSyncing(false)
  }
}
