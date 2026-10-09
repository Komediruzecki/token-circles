/**
 * Loans: every loan at a glance, and each loan on its own page with three tabs (plan 03).
 *
 * GIVEN a user on the Loans page
 * THEN they see what is owed in total, the monthly total, the next loan to finish, and a card per
 *   loan with the share repaid, the balance, installment, rate and payoff date
 * WHEN they click What if on a card
 * THEN the loan's Compare tab opens on the first template's first preset: the loan as planned (A)
 *   beside the what-if (B), in figures, a sentence and one chart
 * WHEN they open a loan
 * THEN its address is #loans/<id>/<tab>, which reload, back and forward all keep, with the
 *   comparison in the query (decision R7)
 * WHEN they add, edit or delete a loan, or an extra payment
 * THEN every figure follows: the write bumps the `loans` data version and the page reloads from it
 */
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { apiDelete, apiHouseholdGet, errorStatus, getLocalCurrency, showToast } from '../core/api'
import { plainMessage } from '../core/apiError'
import { activeProfileId } from '../core/apiProfileScope'
import { useAppState } from '../core/appStore'
import { entityVersion, invalidateEntity } from '../core/dataVersions'
import { refetchOnActive } from '../core/pageVisibility'
import { spotlightActive, spotlightStep, tourSteps } from '../core/spotlightStore'
import { localToday } from '../utils/period'
import { formatsFor } from './loans/loanCopy'
import { toLoanRow } from './loans/loanData'
import LoanDetail from './loans/LoanDetail'
import { FormHost } from './loans/LoanForm'
import { currentQuery, loansHash, parseLoansHash } from './loans/loanRoute'
import styles from './loans/Loans.module.css'
import LoansOverview from './loans/LoansOverview'
import type { ListedLoan, LoanRow } from './loans/loanData'
import type { FormState } from './loans/LoanForm'
import type { LoansRoute } from './loans/loanRoute'
import type { ListStatus } from './loans/LoansOverview'

export default function Loans() {
  const state = useAppState()
  const [rows, setRows] = createSignal<LoanRow[]>([])
  const [status, setStatus] = createSignal<ListStatus>('loading')
  const [offline, setOffline] = createSignal(false)
  const [route, setRoute] = createSignal<LoansRoute>(
    parseLoansHash(window.location.hash) ?? { view: 'overview' }
  )
  const [pendingWhatIf, setPendingWhatIf] = createSignal<number | null>(null)
  const [form, setForm] = createSignal<FormState | null>(null)

  const writeProfileId = () => state.currentProfile?.id ?? activeProfileId()
  const canWrite = (row: LoanRow) => row.profile_id === writeProfileId()
  const ownerName = (row: LoanRow) =>
    state.profiles.find((p) => p.id === row.profile_id)?.name ?? 'another profile'

  // The currency is a setting, read again whenever the profile data changes.
  const currency = createMemo(
    on(
      () => state.profileVersion,
      () => getLocalCurrency()
    )
  )
  const formats = createMemo(() => formatsFor(currency()))
  const axisMoney = (amount: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency(),
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)

  let listToken = 0
  const loadLoans = async () => {
    const mine = ++listToken
    try {
      const data = await apiHouseholdGet<ListedLoan[]>('/api/loans')
      if (mine !== listToken) return
      const today = localToday()
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

  /**
   * Go to a route. A new place (a loan, a tab) is a history entry, so back and forward walk it;
   * a change of what-if replaces the entry, so back leaves the comparison rather than stepping
   * through every preset tried.
   */
  const navigate = (next: LoansRoute, options: { replace?: boolean } = {}) => {
    const target = loansHash(next, currentQuery())
    if (target === window.location.hash) {
      setRoute(next)
      return
    }
    if (options.replace) {
      history.replaceState(history.state, '', target)
      setRoute(next)
    } else {
      window.location.hash = target
    }
  }

  onMount(() => {
    const onHashChange = () => {
      const next = parseLoansHash(window.location.hash)
      if (next) setRoute(next)
    }
    window.addEventListener('hashchange', onHashChange)
    onCleanup(() => {
      window.removeEventListener('hashchange', onHashChange)
    })
  })

  // A tour of this page points at the overview: take it there from a loan's own page.
  createEffect(() => {
    if (!spotlightActive()) return
    const step = tourSteps()[spotlightStep()]
    if (step?.requiredPage === 'loans' && route().view === 'loan') navigate({ view: 'overview' })
  })

  // A loan another tab deleted first answers 404: gone is what was asked, so the page says so and
  // reads the list again. A failed write bumps no counter, so that read has to be asked for.
  const deleteLoan = async (row: LoanRow) => {
    const leave = () => {
      const current = route()
      if (current.view === 'loan' && current.loanId === row.id) {
        navigate({ view: 'overview' }, { replace: true })
      }
    }
    try {
      await apiDelete(`/api/loans/${row.id}`)
      showToast('Loan deleted', 'success')
      leave()
    } catch (err) {
      if (errorStatus(err) === 404) {
        showToast('That loan was already deleted.', 'info')
        invalidateEntity('loans')
        leave()
        return
      }
      console.error('Failed to delete loan:', err)
      showToast(plainMessage(err, "Couldn't delete the loan. Try again."), 'error')
    }
  }

  const loanRoute = () => {
    const r = route()
    return r.view === 'loan' ? r : null
  }

  return (
    <div class={`page page-loans page-enter ${styles.loans}`}>
      <Show
        when={loanRoute()}
        fallback={
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
              setPendingWhatIf(row.id)
              navigate({ view: 'loan', loanId: row.id, tab: 'compare', b: null, a: null })
            }}
            onRetry={() => {
              setStatus('loading')
              void loadLoans()
            }}
          />
        }
      >
        {(r) => {
          const row = () => rows().find((l) => l.id === r().loanId)
          return (
            <LoanDetail
              route={r()}
              row={row()}
              listStatus={status()}
              canWrite={row() ? canWrite(row()!) : false}
              ownerName={row() ? ownerName(row()!) : ''}
              pendingWhatIf={pendingWhatIf() === r().loanId}
              onPendingDone={() => setPendingWhatIf(null)}
              navigate={navigate}
              onEdit={(loan, focusRates) => setForm({ loan, focusRates })}
              onDelete={deleteLoan}
              formats={formats()}
              axisMoney={axisMoney}
            />
          )
        }}
      </Show>

      <FormHost state={form()} onClose={() => setForm(null)} />
    </div>
  )
}
