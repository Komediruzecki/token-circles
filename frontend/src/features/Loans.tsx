/**
 * Loans: every loan at a glance (plan 03).
 *
 * GIVEN a user on the Loans page
 * THEN they see what is owed in total, the monthly total, the next loan to finish, and a card per
 *   loan with the share repaid, the balance, installment, rate and payoff date
 * WHEN they add, edit or delete a loan
 * THEN every figure follows: the write bumps the `loans` data version and the page reloads from it
 *
 * A card's name and its What if lead to the loan's own page, #loans/<id>/<tab>.
 */
import { createSignal } from 'solid-js'
import { todayUtc } from '../../../shared/loanSchedule'
import { apiDelete, apiHouseholdGet, showToast } from '../core/api'
import { activeProfileId } from '../core/apiProfileScope'
import { useAppState } from '../core/appStore'
import { entityVersion } from '../core/dataVersions'
import { refetchOnActive } from '../core/pageVisibility'
import { toLoanRow } from './loans/loanData'
import { FormHost } from './loans/LoanForm'
import { currentQuery, loansHash } from './loans/loanRoute'
import styles from './loans/Loans.module.css'
import LoansOverview from './loans/LoansOverview'
import type { ListedLoan, LoanRow } from './loans/loanData'
import type { FormState } from './loans/LoanForm'
import type { ListStatus } from './loans/LoansOverview'

export default function Loans() {
  const state = useAppState()
  const [rows, setRows] = createSignal<LoanRow[]>([])
  const [status, setStatus] = createSignal<ListStatus>('loading')
  const [offline, setOffline] = createSignal(false)
  const [form, setForm] = createSignal<FormState | null>(null)

  const writeProfileId = () => state.currentProfile?.id ?? activeProfileId()
  const canWrite = (row: LoanRow) => row.profile_id === writeProfileId()
  const ownerName = (row: LoanRow) =>
    state.profiles.find((p) => p.id === row.profile_id)?.name ?? 'another profile'

  let listToken = 0
  const loadLoans = async () => {
    const mine = ++listToken
    try {
      const data = await apiHouseholdGet<ListedLoan[]>('/api/loans')
      if (mine !== listToken) return
      const today = todayUtc()
      setRows(data.map((loan) => toLoanRow(loan, today, writeProfileId())))
      setStatus('ready')
    } catch (err) {
      if (mine !== listToken) return
      console.error('Failed to load loans:', err)
      setOffline(!window.navigator.onLine)
      if (rows().length > 0) {
        showToast('Your loans did not refresh. The figures shown may be out of date.', 'error')
      }
      setStatus('error')
    }
  }

  // Load on mount, and again on a profile change or a loan write from anywhere (resume
  // revalidation included), but only while visible: a hidden page refetches when next shown.
  // Every loan write on this page bumps `loans` through apiFetch, so none reloads by hand.
  refetchOnActive(
    'loans',
    () => [state.profileVersion, entityVersion('loans')],
    () => {
      void loadLoans()
    }
  )

  const deleteLoan = async (row: LoanRow) => {
    try {
      await apiDelete(`/api/loans/${row.id}`)
      showToast('Loan deleted', 'success')
    } catch (err) {
      console.error('Failed to delete loan:', err)
      showToast('The loan was not deleted. Check your connection and try again.', 'error')
    }
  }

  return (
    <div class={`page page-loans page-enter ${styles.loans}`}>
      <LoansOverview
        loans={rows()}
        status={status()}
        offline={offline()}
        canWrite={canWrite}
        ownerName={ownerName}
        onAdd={() => setForm({ loan: null })}
        onEdit={(row) => setForm({ loan: row })}
        onDelete={deleteLoan}
        onWhatIf={(row) => {
          window.location.hash = loansHash(
            { view: 'loan', loanId: row.id, tab: 'compare', b: null, a: null },
            currentQuery()
          )
        }}
        onRetry={() => {
          setStatus('loading')
          void loadLoans()
        }}
      />

      <FormHost state={form()} onClose={() => setForm(null)} />
    </div>
  )
}
