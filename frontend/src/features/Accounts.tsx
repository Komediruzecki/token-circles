/**
 * Accounts Component
 * Handles bank accounts, tracking balances and transaction history
 */

import { createSignal, onMount } from 'solid-js'
import styles from '../components/AccountsPage.module.css'
import { formatCurrency } from '../core/api'

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
        fetch('/api/accounts').then(r => r.json()),
        fetch('/api/transactions/summary').then(r => r.json()),
      ])
      setAccounts(accountsRes)
      setTransactions(txRes?.transactions || [])
    } catch {
      console.error('Failed to load accounts')
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
      await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setShowAddModal(false)
      setFormData({ name: '', type: 'checking', bank_name: '', balance: '', currency: 'USD' })
      loadData()
    } catch (error) {
      console.error('Failed to save account', error)
    }
  }

  // Delete account
  const deleteAccount = async (id: number) => {
    if (!confirm('Are you sure you want to delete this account? All associated transactions will be lost.')) return
    try {
      await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
      loadData()
    } catch (error) {
      console.error('Failed to delete account', error)
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

  // Filter transactions by account
  const getAccountTransactions = (accountId: number) => {
    return transactions().filter((tx: any) => tx.account_id === accountId)
  }

  return (
    <div class={`page page-enter ${styles.accountsPage}`}>
      <div class={styles.pageHeader}>
        <div class={styles.headerTop}>
          <h1>Accounts</h1>
          <button class={`${styles.btn  } ${  styles.btnPrimary}`} onClick={() => setShowAddModal(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add Account
          </button>
        </div>
        <p class={styles.pageSubtitle}>Manage your bank accounts and track balances</p>
      </div>

      {/* Summary Cards */}
      <div class={styles.accountsSummary}>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Total Balance</div>
          <div class={styles.summaryValue}>{formatAmount(totalBalance())}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Accounts</div>
          <div class={styles.summaryValue}>{accounts().length}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Income (this month)</div>
          <div class={`${styles.summaryValue  } ${  styles.positive}`}>+{formatAmount(accounts().reduce((s, a) => {
            const accTxs = getAccountTransactions(a.id).filter((t: any) => t.type === 'income')
            return s + accTxs.reduce((ts, tx) => ts + tx.amount, 0)
          }, 0))}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Expenses (this month)</div>
          <div class={`${styles.summaryValue  } ${  styles.negative}`}>-{formatAmount(accounts().reduce((s, a) => {
            const accTxs = getAccountTransactions(a.id).filter((t: any) => t.type === 'expense')
            return s + accTxs.reduce((ts, tx) => ts + tx.amount, 0)
          }, 0))}</div>
        </div>
      </div>

      {loading() ? (
        <div class="empty-state">Loading accounts...</div>
      ) : accounts().length === 0 ? (
        <div class="empty-state">
          <p>No accounts yet</p>
          <p>Add your first account to start tracking your finances.</p>
          <button class="btn btn-primary" onClick={() => setShowAddModal(true)}>
            Add Account
          </button>
        </div>
      ) : (
        <div class="accounts-grid">
          {accounts().map((account) => (
            <div class="account-card">
              <div class="account-header">
                <div class="account-icon">{getTypeIcon(account.type)}</div>
                <div class="account-info">
                  <h3 class="account-name">{account.name}</h3>
                  <p class="account-bank">{account.bank_name || 'No bank listed'}</p>
                </div>
                <div class="account-actions">
                  <span class={`badge ${getTypeBadge(account.type)}`}>{account.type}</span>
                  <button class="btn btn-sm btn-ghost" onClick={() => deleteAccount(account.id)}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="account-balance">
                <div class="balance-label">Current Balance</div>
                <div class="balance-amount">{formatAmount(account.balance)}</div>
              </div>
              <div class="account-activity">
                <div class="activity-header">
                  <span class="activity-label">Recent Activity</span>
                  <a href="#transactions" class="btn-link">View All →</a>
                </div>
                <div class="activity-list">
                  {getAccountTransactions(account.id).slice(0, 3).map((tx: any) => (
                    <div class="activity-item" >
                      <div class="activity-content">
                        <div class="activity-desc">{tx.description}</div>
                        <div class="activity-date">{new Date(tx.date).toLocaleDateString()}</div>
                      </div>
                      <div class={`activity-amount ${tx.type === 'expense' ? 'expense' : 'income'}`}>
                        {tx.type === 'expense' ? '-' : '+'}{formatAmount(tx.amount)}
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
        <div class="modal-overlay" onclick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div class="modal" onclick={(e) => { e.stopPropagation(); }}>
            <div class="modal-header">
              <h3 class="modal-title">Add Account</h3>
              <button class="modal-close" onClick={() => setShowAddModal(false)}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form class="modal-body" onSubmit={handleSubmit}>
              <div class="form-group">
                <label class="form-label">Account Name</label>
                <input
                  type="text"
                  class="form-control"
                  placeholder="e.g., Checking, Savings"
                  value={formData().name}
                  oninput={(e) => setFormData({ ...formData(), name: e.target.value })}
                  required
                />
              </div>
              <div class="form-group">
                <label class="form-label">Account Type</label>
                <select
                  class="form-control"
                  value={formData().type}
                  oninput={(e) => setFormData({ ...formData(), type: e.target.value as any })}
                >
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                  <option value="credit">Credit Card</option>
                  <option value="investment">Investment</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Bank / Institution</label>
                <input
                  type="text"
                  class="form-control"
                  placeholder="e.g., Chase, Bank of America"
                  value={formData().bank_name || ''}
                  oninput={(e) => setFormData({ ...formData(), bank_name: e.target.value })}
                />
              </div>
              <div class="form-group">
                <label class="form-label">Initial Balance</label>
                <input
                  type="number"
                  step="0.01"
                  class="form-control"
                  placeholder="0.00"
                  value={formData().balance}
                  oninput={(e) => setFormData({ ...formData(), balance: e.target.value })}
                />
              </div>
              <div class="form-group">
                <label class="form-label">Currency</label>
                <select
                  class="form-control"
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
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">
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