/**
 * A loan with its rate periods and extra payments, for whatever draws its schedule: the loan's own
 * page and the chart under its card. Local-first list rows carry both, so the row is the record;
 * the Worker's list does not, so the loan's own read (`GET /api/loans/:id`) supplies them there.
 *
 * The list reloads after every loan write and on a profile change, which hands the caller a new
 * row: that is what reads the loan again here, so no write reloads anything by hand. A record
 * already on screen stays there while it refreshes, and the newest answer wins.
 */
import { createSignal } from 'solid-js'
import { apiGet } from '../../core/api'
import { refetchOnActive } from '../../core/pageVisibility'
import { hasDetails } from './loanData'
import type { LoanRow, StoredLoan } from './loanData'

export type RecordStatus = 'loading' | 'ready' | 'error'

export interface LoanRecord {
  record: () => StoredLoan | null
  status: () => RecordStatus
  /** Read the loan again: the Try again of an error. */
  load: () => Promise<void>
}

export function createLoanRecord(row: () => LoanRow | undefined): LoanRecord {
  const [record, setRecord] = createSignal<StoredLoan | null>(null)
  const [status, setStatus] = createSignal<RecordStatus>('loading')
  let loads = 0

  const load = async () => {
    const current = row()
    const mine = ++loads
    if (!current) {
      setRecord(null)
      setStatus('loading')
      return
    }
    if (hasDetails(current.listed)) {
      setRecord(current.listed)
      setStatus('ready')
      return
    }
    if (record()?.id !== current.id) setStatus('loading')
    try {
      const full = await apiGet<StoredLoan>(`/api/loans/${current.id}`)
      if (mine !== loads) return
      setRecord(full)
      setStatus('ready')
    } catch (err) {
      if (mine !== loads) return
      console.error('Failed to load loan:', err)
      setStatus('error')
    }
  }

  refetchOnActive('loans', row, () => {
    void load()
  })

  return { record, status, load }
}
