/**
 * Accounts Component
 * Handles bank accounts, tracking balances and transaction history
 */

import { createSignal, onMount } from 'solid-js'
import styles from '../components/AccountsPage.module.css'
import { formatCurrency } from '../core/api'
import { apiDelete, apiGet, apiPost, showToast } from '../utils/api'

interface Account {
  id: number
  name: string
  type: 'checking' | 'savings' | 'credit' | 'investment'
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
    type: 'checking',
    bank_name: '',
    balance: '',
    currency: 'USD',
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
    const data = {
      name: formData().name,
      type: formData().type,
      bank_name: formData().bank_name,
      initial_balance: parseFloat(formData().balance) || 0,
      currency: formData().currency,
    }

    try {
      await apiPost('/api/accounts', data)
      showToast('Account created successfully', 'success')
      setShowAddModal(false)
      setFormData({ name: '', type: 'checking', bank_name: '', balance: '', currency: 'USD' })
      loadData()
    } catch (err) {
      console.error('Failed to save account', err)
      showToast('Failed to create account', 'error')
    }
  }

  // Delete account
  const deleteAccount = async (id: number) => {
    if (
      !confirm(
        'Are you sure you want to delete this account? All associated transactions will be lost.'
      )
    )
      return
    try {
      await apiDelete(`/api/accounts/${id}`)
      showToast('Account deleted successfully', 'success')
      loadData()
    } catch (err) {
      console.error('Failed to delete account', err)
      showToast('Failed to delete account', 'error')
    }
  }

  // Get account type badge
  const getTypeBadge = (type: string): string => {
    const badges: Record<string, string> = {
      checking: 'badge-primary',
      savings: 'badge-success',
      credit: 'badge-warning',
      investment: 'badge-info',
    }
    return badges[type] || 'badge-default'
  }

  // Get type icon
  const getTypeIcon = (type: string): string => {
    const icons: Record<string, string> = {
      checking: '🏦',
      savings: '💰',
      credit: '💳',
      investment: '📈',
    }
    return icons[type] || '💼'
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
    <div class={`page page-accounts page-enter ${styles.accountsPage}`}>
      <div class={`${styles.accountsPage} ${styles.pageHeader}`}>
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
          {accounts().map((account) => (
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
                  <span
                    data-test-id="account-type"
                    class={`${styles.badge} ${getTypeBadge(account.type)}`}
                  >
                    {account.type}
                  </span>
                  <button
                    data-test-id="account-delete-btn"
                    class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                    onClick={() => deleteAccount(account.id)}
                  >
                    <svg
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
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
                  <a href="#transactions" class={styles.btnLink}>
                    View All →
                  </a>
                </div>
                <div data-test-id="activity-list" class={styles.activityList}>
                  {getAccountTransactions(account.id)
                    .slice(0, 3)
                    .map((tx: any) => (
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
                    ))}
                </div>
              </div>
            </div>
          ))}
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
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                  <option value="credit">Credit Card</option>
                  <option value="investment">Investment</option>
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
                <label class={styles.formLabel}>Initial Balance</label>
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
