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

import { createSignal, For, onMount } from 'solid-js'
import styles from '../components/AccountsPage.module.css'
import Badge from '../components/Badge'
import ConfirmButton from '../components/ConfirmButton'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, showToast } from '../utils/api'

interface Account {
  id: number
  name: string
  type: 'giro' | 'savings' | 'ib' | 'cash'
  balance: number
  currency: string
  bank_name?: string
  last_activity?: string
  profile_id: number
}

export default function Accounts() {
  const [accounts, setAccounts] = createSignal<Account[]>([])
  const [transactions, setTransactions] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)
  const [showAddModal, setShowAddModal] = createSignal(false)
  const [formData, setFormData] = createSignal({
    name: '',
    type: 'giro',
    bank_name: '',
    balance: '',
    currency: 'USD',
    starting_balance: '',
    starting_date: '',
  })

  // Load accounts and transactions
  const loadData = async () => {
    setLoading(true)
    try {
      const [accountsRes, txRes] = await Promise.all([
        apiGet<Account[]>('/api/accounts'),
        apiGet<any>('/api/transactions/summary'),
      ])
      setAccounts(accountsRes)
      setTransactions(Array.isArray(txRes) ? txRes : [])
    } catch (err) {
      console.error('Failed to load accounts', err)
      showToast('Failed to load accounts', 'error')
    } finally {
      setLoading(false)
    }
  }

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
      setShowAddModal(false)
      setFormData({
        name: '',
        type: 'giro',
        bank_name: '',
        balance: '',
        currency: 'USD',
        starting_balance: '',
        starting_date: '',
      })
      loadData()
    } catch (err) {
      console.error('Failed to save account', err)
      showToast('Failed to create account', 'error')
    }
  }

  // Delete account
  const deleteAccount = async (id: number) => {
    try {
      await apiDelete(`/api/accounts/${id}`)
      showToast('Account deleted successfully', 'success')
      loadData()
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
      giro:
        'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01',
      savings:
        'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      ib: 'M13 17V9m-4 8v-4m8 4v-2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
      cash:
        'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
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

  onMount(() => {
    loadData()
  })

  // Calculate total balance
  const totalBalance = () => {
    return accounts().reduce((sum, acc) => sum + acc.balance, 0)
  }

  // Filter transactions by account (now just returns empty array if non-array)
  const getAccountTransactions = (_accountId: number) => {
    const txs = transactions()
    return Array.isArray(txs) ? txs : []
  }

  return (
    <div class={`${styles.accountsPage} page page-accounts page-enter`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1 data-test-id="accounts-header">Accounts</h1>
          <button
            data-test-id="add-account-btn"
            class={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setShowAddModal(true)}
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
      <div data-test-id="accounts-summary" class={styles.accountsSummary}>
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
            +
            {formatAmount(
              0 // TODO: Need to implement monthly income calculation when transactions have account_id
            )}
          </div>
        </div>
        <div data-test-id="summary-expenses" class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Expenses (this month)</div>
          <div
            data-test-id="summary-expenses-value"
            class={`${styles.summaryValue} ${styles.negative}`}
          >
            -
            {formatAmount(
              0 // TODO: Need to implement monthly expense calculation when transactions have account_id
            )}
          </div>
        </div>
      </div>

      {loading() ? (
        <div class={styles.emptyState}>Loading accounts...</div>
      ) : accounts().length === 0 ? (
        <div class={styles.emptyState}>
          <p>No accounts yet</p>
          <p>Add your first account to start tracking your finances.</p>
          <button
            class={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setShowAddModal(true)}
          >
            Add Account
          </button>
        </div>
      ) : (
        <div data-test-id="accounts-grid" class={styles.accountsGrid}>
          <For each={accounts()}>
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
                    <Badge status={getAccountBadgeStatus(account.type)}>{account.type}</Badge>
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
                    <a href={`#transactions?category=${encodeURIComponent(account.name)}`} class={styles.btnLink}>
                      View All →
                    </a>
                  </div>
                  <div data-test-id="activity-list" class={styles.activityList}>
                    <For each={getAccountTransactions(account.id).slice(0, 3)}>
                      {(tx: any) => (
                        <div data-test-id="activity-item" class={styles.activityItem}>
                          <div data-test-id="activity-desc" class={styles.activityContent}>
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
      )}

      {/* Add Account Modal */}
      {showAddModal() && (
        <div
          class={styles.modalOverlay}
          onclick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false)
          }}
        >
          <div
            class={styles.modal}
            onclick={(e) => {
              e.stopPropagation()
            }}
          >
            <div class={styles.modalHeader}>
              <h3 class={styles.modalTitle}>Add Account</h3>
              <button class={styles.modalClose} onClick={() => setShowAddModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class={styles.modalBody} onSubmit={handleSubmit}>
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
              <div class={styles.formGroup}>
                <label class={styles.formLabel}>Starting Balance</label>
                <input
                  type="number"
                  step="0.01"
                  class={styles.formControl}
                  placeholder="0.00"
                  value={formData().starting_balance || formData().balance}
                  oninput={(e) => setFormData({ ...formData(), starting_balance: e.target.value })}
                />
              </div>
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
              </div>
              <div class={styles.modalFooter}>
                <button
                  type="button"
                  class={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" class={`${styles.btn} ${styles.btnPrimary}`}>
                  Add Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
