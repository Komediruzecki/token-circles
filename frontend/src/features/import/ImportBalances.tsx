/**
 * The balances after an import (review M2): each account the import touched, with its balance
 * today, and "Not what your bank shows? Set today's balance". A statement starts from wherever the
 * account stood, so the balance it leaves can differ from the bank's; the figure typed here is set
 * as the balance today, with the entries worked back from it (core/balanceToday.ts), in either
 * storage mode.
 */
import { createSignal, Index, onMount, Show } from 'solid-js'
import { formatCurrency, showToast } from '../../core/api'
import { balanceToday, setBalanceToday, storedAccounts } from '../../core/balanceToday'
import { parseDecimalInput } from '../../core/decimalInput'
import pageStyles from '../Import.module.css'
import styles from './ImportBalances.module.css'
import type { JSX } from 'solid-js'
import type { StoredAccount } from '../../core/balanceToday'

/**
 * The accounts an import touched: those whose stored balance moved since `before` (id to balance,
 * read just before it ran), and those it made.
 */
export function touchedSince(
  before: ReadonlyMap<number, number>,
  after: readonly StoredAccount[]
): StoredAccount[] {
  return after.filter((account) => {
    const was = before.get(account.id)
    return was === undefined || Math.abs(was - account.balance) > 0.005
  })
}

/** What the accounts held, by id, for `touchedSince`. */
export async function balancesById(): Promise<Map<number, number>> {
  return new Map((await storedAccounts()).map((account) => [account.id, account.balance]))
}

interface Row {
  account: StoredAccount
  today: number
}

const UNREAD = 'Type the balance as a number, like 1240.50.'

export function ImportBalances(props: { accounts: readonly StoredAccount[] }): JSX.Element {
  const [rows, setRows] = createSignal<Row[]>([])
  const [editing, setEditing] = createSignal<number | null>(null)
  const [draft, setDraft] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)
  let input: HTMLInputElement | undefined

  const read = async (accounts: readonly StoredAccount[]): Promise<Row[]> =>
    Promise.all(accounts.map(async (account) => ({ account, today: await balanceToday(account) })))

  onMount(() => {
    void read(props.accounts).then(setRows)
  })

  const open = (id: number) => {
    setEditing(id)
    setDraft('')
    setError(null)
    queueMicrotask(() => input?.focus())
  }

  const save = async (row: Row) => {
    const figure = parseDecimalInput(draft())
    if (draft().trim() === '' || figure === null) {
      setError(UNREAD)
      input?.focus()
      return
    }
    setSaving(true)
    try {
      // The account as stored now, not as the list read it: an entry saved since then moved its
      // balance, and the starting balance worked back from the old one would be off by it.
      const now = (await storedAccounts()).find((account) => account.id === row.account.id)
      await setBalanceToday(now ?? row.account, figure)
      // Read back from what is stored now, so the line shows what the app holds.
      const stored = (await storedAccounts()).find((account) => account.id === row.account.id)
      const next = stored ? await read([stored]) : []
      setRows((all) =>
        all.map((one) => (one.account.id === row.account.id && next[0] ? next[0] : one))
      )
      setEditing(null)
      showToast(`${row.account.name} reads ${formatCurrency(figure)} today.`, 'success')
    } catch {
      setError("Couldn't set the balance. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Show when={props.accounts.length > 0}>
      <section
        class={styles.balances}
        aria-labelledby="import-balances-title"
        data-test-id="import-balances"
      >
        <h2 id="import-balances-title" class={styles.title}>
          Balances today
        </h2>
        <ul class={styles.list}>
          <Index each={rows()}>
            {(row) => (
              <li class={styles.row} data-test-id="import-balance-row">
                <span class={styles.name}>{row().account.name}</span>
                <span class={styles.figure} data-test-id="import-balance-today">
                  {formatCurrency(row().today)}
                </span>
                <Show
                  when={editing() === row().account.id}
                  fallback={
                    <button
                      type="button"
                      class={styles.set}
                      data-test-id="import-balance-set"
                      onClick={() => {
                        open(row().account.id)
                      }}
                    >
                      Not what your bank shows? Set today's balance
                    </button>
                  }
                >
                  <form
                    class={styles.form}
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault()
                      void save(row())
                    }}
                  >
                    <label class={styles.label} for={`import-balance-${row().account.id}`}>
                      What {row().account.name} shows at your bank today
                    </label>
                    <input
                      ref={input}
                      id={`import-balance-${row().account.id}`}
                      class={styles.input}
                      data-test-id="import-balance-input"
                      type="text"
                      inputmode="decimal"
                      autocomplete="off"
                      placeholder="0.00"
                      aria-invalid={error() !== null}
                      aria-describedby={
                        error() !== null ? `import-balance-${row().account.id}-error` : undefined
                      }
                      value={draft()}
                      onInput={(event) => {
                        setDraft(event.currentTarget.value)
                        setError(null)
                      }}
                    />
                    <button
                      type="submit"
                      class={`${pageStyles.btn} ${pageStyles.btnPrimary} ${styles.button}`}
                      data-test-id="import-balance-save"
                      disabled={saving()}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      class={`${pageStyles.btn} ${pageStyles.btnGhost} ${styles.button}`}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                    <Show when={error()}>
                      <p
                        id={`import-balance-${row().account.id}-error`}
                        class={styles.error}
                        data-test-id="import-balance-error"
                      >
                        {error()}
                      </p>
                    </Show>
                  </form>
                </Show>
              </li>
            )}
          </Index>
        </ul>
      </section>
    </Show>
  )
}
