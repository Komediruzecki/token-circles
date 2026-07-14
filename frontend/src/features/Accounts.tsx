/**
 * Accounts Component - EARS Specification
 *
 * GIVEN: A user is viewing the Accounts page
 * WHEN: The page loads
 * THEN: The header displays "Accounts" and a grid of all accounts is visible
 *
 * GIVEN: A user wants to add a new account
 * WHEN: They click the "Add Account" button
 * THEN: An "Add Account" modal opens with form fields for account name, type, and initial balance
 *
 * GIVEN: A user has added a new account
 * WHEN: They save the account form with valid data
 * THEN: The new account appears in the accounts grid with its balance updated
 *
 * GIVEN: A user wants to delete an account
 * WHEN: They select an account and click delete
 * THEN: The account is removed from the grid and a confirmation message is shown
 *
 * GIVEN: A user has multiple accounts
 * WHEN: The page displays the accounts grid
 * THEN: Accounts are grouped by type (Checking, Savings, Credit, Investment)
 *
 * GIVEN: A user views an account with transactions
 * WHEN: They click on a transaction line
 * THEN: The transaction details are shown and the transaction modal opens
 */

/**
 * Accounts Component
 * Handles bank accounts, tracking balances and transaction history
 */

import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js'
import AccountConstellation from '../components/AccountConstellation'
import Badge from '../components/Badge'
import ConfirmButton from '../components/ConfirmButton'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../core/api'
import { useAppState } from '../core/appStore'
import { gatedSource } from '../core/pageVisibility'
import styles from './AccountsPage.module.css'

interface Account {
  id: number
  name: string
  type: 'giro' | 'savings' | 'ib' | 'cash'
  balance: number
  currency: string
  bank_name?: string
  starting_balance?: number
  starting_date?: string | null
  last_activity?: string
  profile_id: number
}

export default function Accounts() {
  const state = useAppState()

  // Accounts resource — fetches accounts, transactions, and profiles
  const [accountsResource, { refetch: refetchAccounts }] = createResource(
    // Gated on visibility: a profile switch refetches this page now only if it is
    // visible; hidden, it is marked stale and refetches once on the next show.
    gatedSource('accounts', () => state.profileVersion),
    async () => {
      const [accountsRes, txRes, profilesRes] = await Promise.all([
        apiGet<Account[]>('/api/accounts'),
        apiGet<any>(`/api/transactions?limit=500`),
        apiGet<Array<{ id: number; name: string }>>('/api/profiles').catch(() => []),
      ])
      const txList = Array.isArray(txRes) ? txRes : txRes?.transactions || txRes?.rows || []
      return {
        accounts: accountsRes,
        transactions: Array.isArray(txList) ? txList : [],
        profiles: profilesRes,
      }
    }
  )
  const [initialLoad, setInitialLoad] = createSignal(true)
  const accounts = () => accountsResource()?.accounts ?? []
  const transactions = () => accountsResource()?.transactions ?? []
  const profiles = () => accountsResource()?.profiles ?? []
  createEffect(() => {
    if (!accountsResource.loading) setInitialLoad(false)
  })
  const emptyForm = () => ({
    name: '',
    type: 'giro',
    bank_name: '',
    balance: '',
    currency: 'USD',
    starting_balance: '',
    starting_date: '',
  })
  // null = closed; 'add' = create; 'edit' = update the account held in editingAccount().
  const [modalMode, setModalMode] = createSignal<'add' | 'edit' | null>(null)
  const [editingAccount, setEditingAccount] = createSignal<Account | null>(null)
  const [formData, setFormData] = createSignal(emptyForm())

  const openAddModal = () => {
    setEditingAccount(null)
    setFormData(emptyForm())
    setModalMode('add')
  }

  const openEditModal = (account: Account) => {
    setEditingAccount(account)
    setFormData({
      name: account.name,
      type: account.type,
      bank_name: account.bank_name || '',
      // The Current Balance field is prefilled with the derived balance; changing it
      // adjusts the starting balance under the hood (see handleEditSubmit).
      balance: String(account.balance ?? ''),
      currency: account.currency || 'USD',
      starting_balance: String(account.starting_balance ?? ''),
      starting_date: account.starting_date || '',
    })
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode(null)
    setEditingAccount(null)
    setFormData(emptyForm())
  }

  const profileNameMap = createMemo(() => {
    const map = new Map<number, string>()
    for (const p of profiles()) map.set(p.id, p.name)
    return map
  })

  const multiProfile = createMemo(() => {
    const ids = new Set(accounts().map((a) => a.profile_id))
    return ids.size > 1
  })

  const accountsByProfile = createMemo(() => {
    if (!multiProfile()) return [{ profileId: 0, profileName: '', accounts: accounts() }]
    const groups = new Map<number, Account[]>()
    for (const a of accounts()) {
      const list = groups.get(a.profile_id) || []
      list.push(a)
      groups.set(a.profile_id, list)
    }
    const names = profileNameMap()
    return Array.from(groups.entries()).map(([pid, accts]) => ({
      profileId: pid,
      profileName: names.get(pid) || `Profile ${pid}`,
      accounts: accts,
    }))
  })

  // Handle form submit
  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const data: Record<string, unknown> = {
      name: formData().name,
      type: formData().type,
      bank_name: formData().bank_name,
      balance: parseFloat(formData().balance) || 0,
      currency: formData().currency,
      starting_balance: formData().starting_balance
        ? parseFloat(formData().starting_balance)
        : parseFloat(formData().balance) || 0,
      starting_date: formData().starting_date || null,
    }

    try {
      await apiPost('/api/accounts', data)
      showToast('Account created successfully', 'success')
      closeModal()
      refetchAccounts()
    } catch (err) {
      console.error('Failed to save account', err)
      showToast('Failed to create account', 'error')
    }
  }

  // Handle edit submit. Info fields (name/type/bank/currency/starting date) update directly.
  // The Current Balance field is a correction: because balance is derived (starting_balance +
  // the ledger), we shift starting_balance by the delta and send the matching balance so the
  // fix survives a recompute and future transactions apply on top of it — rather than writing
  // an absolute balance that the next recompute would silently revert.
  const handleEditSubmit = async (e: Event) => {
    e.preventDefault()
    const acct = editingAccount()
    if (!acct) return
    const body: Record<string, unknown> = {
      name: formData().name,
      type: formData().type,
      bank_name: formData().bank_name,
      currency: formData().currency,
      starting_date: formData().starting_date || null,
    }
    const desiredCurrent = Math.round(parseFloat(formData().balance) * 100) / 100
    if (Number.isFinite(desiredCurrent) && Math.abs(desiredCurrent - (acct.balance ?? 0)) > 0.005) {
      const ledger = (acct.balance ?? 0) - (acct.starting_balance ?? 0)
      body.starting_balance = Math.round((desiredCurrent - ledger) * 100) / 100
      body.balance = desiredCurrent
    }

    try {
      await apiPut(`/api/accounts/${acct.id}`, body)
      showToast('Account updated successfully', 'success')
      closeModal()
      refetchAccounts()
    } catch (err) {
      console.error('Failed to update account', err)
      showToast('Failed to update account', 'error')
    }
  }

  // Delete account
  const deleteAccount = async (id: number) => {
    try {
      await apiDelete(`/api/accounts/${id}`)
      showToast('Account deleted successfully', 'success')
      refetchAccounts()
    } catch (err) {
      console.error('Failed to delete account', err)
      showToast('Failed to delete account', 'error')
    }
  }

  // Get account type badge status
  const getAccountBadgeStatus = (
    type: string
  ): 'primary' | 'success' | 'warning' | 'info' | 'default' => {
    const statusMap: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'default'> = {
      giro: 'primary',
      savings: 'success',
      ib: 'info',
      cash: 'warning',
    }
    return statusMap[type] || 'default'
  }

  // Get type icon
  const getTypeIcon = (type: string) => {
    const paths: Record<string, string> = {
      giro: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01',
      savings:
        'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      ib: 'M13 17V9m-4 8v-4m8 4v-2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      cash: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    }
    const d =
      paths[type] ||
      'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
    return (
      <svg
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <path d={d} />
      </svg>
    )
  }

  // Format currency
  const formatAmount = (amount: number): string => {
    return formatCurrency(amount)
  }

  // Calculate total balance
  const totalBalance = createMemo(() => {
    return accounts().reduce((sum, acc) => sum + acc.balance, 0)
  })

  // Filter transactions by account — money in or out: the account's own
  // income/expense/transfer-out (account_id) plus transfers received (transfer_account_id).
  const getAccountTransactions = (accountId: number) => {
    const txs = transactions()
    return Array.isArray(txs)
      ? txs.filter((t) => t.account_id === accountId || t.transfer_account_id === accountId)
      : []
  }

  // Compute monthly income from loaded transactions
  const monthlyIncome = createMemo(() => {
    const now = new Date()
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const txs = transactions()
    if (!Array.isArray(txs)) return 0
    return txs
      .filter((t) => t.date?.startsWith(monthStr) && t.type === 'income')
      .reduce((s, t) => s + (t.amount || 0), 0)
  })

  const monthlyExpenses = createMemo(() => {
    const now = new Date()
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const txs = transactions()
    if (!Array.isArray(txs)) return 0
    return txs
      .filter((t) => t.date?.startsWith(monthStr) && t.type === 'expense')
      .reduce((s, t) => s + (t.amount || 0), 0)
  })

  return (
    <div class={`${styles.accountsPage} page page-accounts page-enter`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="accounts-header" data-tour="accounts-header">
            Accounts
          </h1>
          <button
            data-test-id="add-account-btn"
            data-tour="accounts-add"
            class={`${styles.btn} ${styles.btnPrimary}`}
            onClick={openAddModal}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Account
          </button>
        </div>
        <p data-test-id="accounts-subtitle" class={styles.pageSubtitle}>
          Manage your bank accounts and track balances
        </p>
      </div>

      {/* Summary Cards */}
      <div
        data-test-id="accounts-summary"
        class={styles.accountsSummary}
        data-tour="accounts-summary"
      >
        <div data-test-id="summary-total-balance" class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Total Balance</div>
          <div data-test-id="summary-balance-value" class={styles.summaryValue}>
            {formatAmount(totalBalance())}
          </div>
        </div>
        <div data-test-id="summary-accounts-count" class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Accounts</div>
          <div data-test-id="summary-accounts-value" class={styles.summaryValue}>
            {accounts().length}
          </div>
        </div>
        <div data-test-id="summary-income" class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Income (this month)</div>
          <div
            data-test-id="summary-income-value"
            class={`${styles.summaryValue} ${styles.positive}`}
          >
            +{formatAmount(monthlyIncome())}
          </div>
        </div>
        <div data-test-id="summary-expenses" class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Expenses (this month)</div>
          <div
            data-test-id="summary-expenses-value"
            class={`${styles.summaryValue} ${styles.negative}`}
          >
            -{formatAmount(monthlyExpenses())}
          </div>
        </div>
      </div>

      <Show when={accounts().length > 0}>
        <div class={styles.netWorthMap}>
          <h3 class={styles.netWorthMapTitle}>Net worth map</h3>
          <AccountConstellation
            accounts={accounts().map((a) => ({
              id: a.id,
              name: a.name,
              type: a.type,
              balance: a.balance,
              bank_name: a.bank_name,
            }))}
          />
        </div>
      </Show>

      <div data-tour="accounts-list">
        {initialLoad() && accounts().length === 0 ? (
          <div class={styles.emptyState}>Loading accounts...</div>
        ) : accounts().length === 0 ? (
          <div class={styles.emptyState}>
            <p>No accounts yet</p>
            <p>Add your first account to start tracking your finances.</p>
            <button class={`${styles.btn} ${styles.btnPrimary}`} onClick={openAddModal}>
              Add Account
            </button>
          </div>
        ) : (
          <For each={accountsByProfile()}>
            {(group) => (
              <>
                {multiProfile() && (
                  <h2 class={styles.profileGroupHeader}>
                    <span class={styles.profileGroupDot}></span>
                    {group.profileName}
                    <span class={styles.profileGroupCount}>{group.accounts.length} accounts</span>
                  </h2>
                )}
                <div data-test-id="accounts-grid" class={styles.accountsGrid}>
                  <For each={group.accounts}>
                    {(account) => (
                      <div data-test-id="account-card" class={styles.accountCard}>
                        <div class={styles.accountHeader}>
                          <div data-test-id="account-icon" class={styles.accountIcon}>
                            {getTypeIcon(account.type)}
                          </div>
                          <div class={styles.accountInfo}>
                            <h3 data-test-id="account-name" class={styles.accountName}>
                              {account.name}
                            </h3>
                            <p data-test-id="account-bank" class={styles.accountBank}>
                              {account.bank_name || 'No bank listed'}
                            </p>
                          </div>
                          <div class={styles.accountActions}>
                            <span data-test-id="account-type" style={{ display: 'contents' }}>
                              <Badge status={getAccountBadgeStatus(account.type)}>
                                {account.type}
                              </Badge>
                            </span>
                            <button
                              data-test-id="account-edit-btn"
                              class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                              title="Edit account"
                              aria-label="Edit account"
                              onClick={() => {
                                openEditModal(account)
                              }}
                            >
                              <svg
                                width="16"
                                height="16"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <span data-test-id="account-delete-btn" style={{ display: 'contents' }}>
                              <ConfirmButton
                                class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                                onConfirm={() => deleteAccount(account.id)}
                                confirmLabel="Delete? This will remove all related transactions."
                                label={
                                  <svg
                                    width="16"
                                    height="16"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                }
                              />
                            </span>
                          </div>
                        </div>
                        <div data-test-id="current-balance-card" class={styles.accountBalance}>
                          <div class={styles.balanceLabel}>Current Balance</div>
                          <div data-test-id="account-balance" class={styles.balanceAmount}>
                            {formatAmount(account.balance)}
                          </div>
                        </div>
                        <div data-test-id="activity-section" class={styles.accountActivity}>
                          <div class={styles.activityHeader}>
                            <span class={styles.activityLabel}>Recent Activity</span>
                            <a
                              href={`#transactions?account=${account.id}`}
                              class={styles.btnLink}
                              data-test-id="activity-view-all"
                            >
                              View All →
                            </a>
                          </div>
                          <div data-test-id="activity-list" class={styles.activityList}>
                            <For each={getAccountTransactions(account.id).slice(0, 3)}>
                              {(tx: any) => (
                                <div data-test-id="activity-item" class={styles.activityItem}>
                                  <div
                                    data-test-id="activity-content"
                                    class={styles.activityContent}
                                  >
                                    <div data-test-id="activity-desc" class={styles.activityDesc}>
                                      {tx.description}
                                    </div>
                                    <div data-test-id="activity-date" class={styles.activityDate}>
                                      {new Date(tx.date).toLocaleDateString()}
                                    </div>
                                  </div>
                                  <div
                                    data-test-id="activity-amount"
                                    class={`${styles.activityAmount} ${tx.type === 'expense' ? styles.expense : styles.income}`}
                                  >
                                    {tx.type === 'expense' ? '-' : '+'}
                                    {formatAmount(tx.amount)}
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </>
            )}
          </For>
        )}
      </div>

      {/* Add / Edit Account Modal */}
      {modalMode() !== null && (
        <div
          data-test-id={modalMode() === 'edit' ? 'edit-account-modal' : 'add-account-modal'}
          class={`${styles.modalOverlay} ${styles.visible}`}
          onclick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>
                {modalMode() === 'edit' ? 'Edit Account' : 'Add Account'}
              </h3>
              <button class={styles.modalClose} onClick={closeModal}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form
              class={styles.modalBody}
              onSubmit={modalMode() === 'edit' ? handleEditSubmit : handleSubmit}
            >
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Account Name</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., Checking, Savings"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  required
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Account Type</label>
                <select
                  class={styles.formControl}
                  value={formData().type}
                  oninput={(e) => setFormData({ ...formData(), type: e.target.value as any })}
                >
                  <option value="giro">Giro / Checking</option>
                  <option value="savings">Savings</option>
                  <option value="ib">Investment / Brokerage</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Bank / Institution</label>
                <input
                  type="text"
                  class={styles.formControl}
                  placeholder="e.g., Chase, Bank of America"
                  value={formData().bank_name || ''}
                  oninput={(e) => setFormData({ ...formData(), bank_name: e.target.value })}
                />
              </div>
              <Show when={modalMode() === 'add'}>
                <div class={styles.formGroup}>
                  <label class={styles.formLabel}>Starting Balance</label>
                  <input
                    type="number"
                    step="0.01"
                    class={styles.formControl}
                    placeholder="0.00"
                    value={formData().starting_balance || formData().balance}
                    oninput={(e) =>
                      setFormData({ ...formData(), starting_balance: e.target.value })
                    }
                  />
                </div>
              </Show>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Starting Date</label>
                <input
                  type="date"
                  class={styles.formControl}
                  value={formData().starting_date}
                  oninput={(e) => setFormData({ ...formData(), starting_date: e.target.value })}
                />
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Current Balance</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="0.00"
                  value={formData().balance}
                  oninput={(e) => setFormData({ ...formData(), balance: e.target.value })}
                />
                <Show when={modalMode() === 'edit'}>
                  <p class={styles.formHint}>
                    Correcting this adjusts the starting balance so your transaction history stays
                    intact.
                  </p>
                </Show>
              </div>
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Currency</label>
                <select
                  class={styles.formControl}
                  value={formData().currency}
                  oninput={(e) => setFormData({ ...formData(), currency: e.target.value })}
                >
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British Pound</option>
                  <option value="JPY">JPY - Japanese Yen</option>
                  <option value="CAD">CAD - Canadian Dollar</option>
                </select>
                <Show when={modalMode() === 'edit'}>
                  <p class={styles.formHint}>
                    Relabels the account only — existing balances and transactions are not
                    converted.
                  </p>
                </Show>
              </div>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button type="submit" class={`${styles.btn} ${styles.btnPrimary}`}>
                  {modalMode() === 'edit' ? 'Save Changes' : 'Add Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
