/**
 * Account picker with in-place creation — a dropdown of the user's accounts plus a
 * "New account…" option that expands into a compact create form, so flows that
 * assign transactions to accounts (bank statement import, onboarding) never have
 * to send the user away to the Accounts page. Creation posts the same payload as
 * the Accounts form (starting_balance mirrors balance so the opening balance
 * survives balance recomputes).
 */
import { createSignal, For, Show } from 'solid-js'
import { apiPost, getLocalCurrency, toast } from '../core/api'
import styles from './AccountSelect.module.css'
import type { AccountType } from '../types/models'

const CREATE_SENTINEL = '__create-account__'

export interface AccountOption {
  id: number
  name: string
  bank_name?: string | null
}

export interface AccountSelectProps {
  accounts: () => AccountOption[]
  /** Selected account NAME ('' = none). Bank imports link by name (means_of_payment). */
  value: () => string
  onChange: (name: string) => void
  /** Called after a successful in-place creation, before onChange(name). */
  onCreated?: (account: { id: number; name: string }) => void | Promise<void>
  /** Prefill for the new-account name, e.g. derived from the statement's bank. */
  suggestedName?: () => string
  testId?: string
}

export function AccountSelect(props: AccountSelectProps) {
  const [creating, setCreating] = createSignal(false)
  const [submitting, setSubmitting] = createSignal(false)
  const [name, setName] = createSignal('')
  const [type, setType] = createSignal<AccountType>('giro')
  const [currency, setCurrency] = createSignal(getLocalCurrency())
  const [balance, setBalance] = createSignal('')
  const [formError, setFormError] = createSignal<string | null>(null)

  const openCreate = () => {
    setName(props.suggestedName?.() ?? '')
    setType('giro')
    setCurrency(getLocalCurrency())
    setBalance('')
    setFormError(null)
    setCreating(true)
  }

  const closeCreate = () => {
    setCreating(false)
    setFormError(null)
  }

  const submit = async () => {
    const trimmed = name().trim()
    if (!trimmed) {
      setFormError('Account name is required')
      return
    }
    if (props.accounts().some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
      setFormError('An account with this name already exists — pick it from the list instead')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const opening = parseFloat(balance()) || 0
      const created = await apiPost<{ id: number }>('/api/accounts', {
        name: trimmed,
        type: type(),
        currency: currency(),
        balance: opening,
        starting_balance: opening,
      })
      toast(`Account "${trimmed}" created`, 'success')
      await props.onCreated?.({ id: created.id, name: trimmed })
      props.onChange(trimmed)
      setCreating(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create the account')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div class={styles.wrap}>
      <select
        class={styles.select}
        data-test-id={props.testId ?? 'account-select'}
        value={creating() ? CREATE_SENTINEL : props.value()}
        onChange={(e) => {
          const v = e.currentTarget.value
          if (v === CREATE_SENTINEL) {
            openCreate()
            return
          }
          closeCreate()
          props.onChange(v)
        }}
      >
        <option value="">Choose account…</option>
        <For each={props.accounts()}>{(a) => <option value={a.name}>{a.name}</option>}</For>
        <option value={CREATE_SENTINEL}>New account…</option>
      </select>

      <Show when={creating()}>
        <div class={styles.createCard} data-test-id="account-select-create">
          <div class={styles.createGrid}>
            <input
              class={styles.field}
              placeholder="Account name"
              value={name()}
              data-test-id="account-select-name"
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
            <select
              class={styles.field}
              value={type()}
              data-test-id="account-select-type"
              onChange={(e) => setType(e.currentTarget.value as AccountType)}
            >
              <option value="giro">Giro / Checking</option>
              <option value="savings">Savings</option>
              <option value="ib">Investment</option>
              <option value="cash">Cash</option>
            </select>
            <select
              class={styles.field}
              value={currency()}
              data-test-id="account-select-currency"
              onChange={(e) => setCurrency(e.currentTarget.value)}
            >
              <For each={['EUR', 'USD', 'GBP', 'JPY', 'CAD']}>
                {(c) => <option value={c}>{c}</option>}
              </For>
            </select>
            <input
              class={styles.field}
              type="text"
              inputmode="decimal"
              placeholder="Opening balance (optional)"
              value={balance()}
              data-test-id="account-select-balance"
              onInput={(e) => setBalance(e.currentTarget.value)}
            />
          </div>
          <Show when={formError()}>
            <p class={styles.error}>{formError()}</p>
          </Show>
          <div class={styles.createActions}>
            <button
              class={styles.createBtn}
              disabled={submitting()}
              data-test-id="account-select-submit"
              onClick={() => void submit()}
            >
              {submitting() ? 'Creating…' : 'Create account'}
            </button>
            <button class={styles.cancelBtn} disabled={submitting()} onClick={closeCreate}>
              Cancel
            </button>
          </div>
        </div>
      </Show>
    </div>
  )
}
