/**
 * SubscriptionCard — compact, single-row subscription card.
 *
 * Brand icon · name + category/frequency line · amount with due countdown, then exactly two
 * controls: one primary action (Mark paid — absent once paid this period, because a second
 * mark-paid can only 409) and a "…" menu holding Pause/Resume, Edit and Delete. Delete confirms
 * through the app's danger dialog; nothing on the card is destructive in one tap.
 */

/** @jsxImportSource solid-js */
import { Show } from 'solid-js'
import { formatCurrency } from '../core/api'
import { showConfirm } from '../core/confirmStore'
import { frequencySuffix } from '../core/subscriptionMath'
import { matchBrand } from '../features/subscriptionBrands'
import { subscriptionCategoryLabel } from '../features/subscriptionFilters'
import OverflowMenu from './OverflowMenu'
import styles from './SubscriptionCard.module.css'

export interface SubscriptionCardBill {
  id: number
  name: string
  amount: number
  due_date: string
  frequency: string
  is_active?: number
  paid?: boolean
  category?: string
  category_name?: string
  category_color?: string
  type?: string
}

interface SubscriptionCardProps {
  subscription: SubscriptionCardBill
  onMarkPaid: (id: number) => void
  /** Toggles paused state: pauses an active subscription, resumes a paused one. */
  onPause: (id: number) => void
  onDelete: (id: number) => void
  onEdit: (id: number) => void
  markingPaid: () => Set<number>
}

/* ── Due date helpers ── */

function dueText(dateStr: string): string {
  const target = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  return `Due in ${diff}d`
}

function dueClass(dateStr: string): string {
  const target = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff < 0) return styles.dueOverdue
  if (diff <= 1) return styles.dueSoon
  return styles.dueNormal
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export default function SubscriptionCard(props: SubscriptionCardProps) {
  const sub = () => props.subscription
  const brand = () => matchBrand(sub().name, sub().category_color)
  const isActive = () => sub().is_active !== 0
  const isPaying = () => props.markingPaid().has(sub().id)

  const confirmDelete = async () => {
    const ok = await showConfirm('Delete this subscription? This can’t be undone.', {
      danger: true,
      confirmText: 'Delete',
    })
    if (ok) props.onDelete(sub().id)
  }

  return (
    <div class={`${styles.card} ${!isActive() ? styles.paused : ''}`} data-test-id="sub-card">
      <div
        class={styles.iconBox}
        style={{
          'background-color': brand().bgColor,
          color: brand().color,
        }}
      >
        {brand().icon()}
      </div>

      <div class={styles.info}>
        <h4 class={styles.name} title={sub().name}>
          {brand().displayName || sub().name}
        </h4>
        <p class={styles.meta}>
          {subscriptionCategoryLabel(sub())}
          {' · '}
          <span title={sub().due_date}>{formatDate(sub().due_date)}</span>
        </p>
      </div>

      <div class={styles.trail}>
        <div class={styles.amountCol}>
          <span class={styles.amountValue}>
            {formatCurrency(sub().amount)}
            <span class={styles.frequency}>/{frequencySuffix(sub().frequency)}</span>
          </span>
          <Show
            when={isActive()}
            fallback={<span class={styles.pausedBadge}>Paused</span>}
          >
            <span class={`${styles.due} ${dueClass(sub().due_date)}`}>
              {dueText(sub().due_date)}
            </span>
          </Show>
        </div>

        <div class={styles.actions}>
          <Show
            when={!sub().paid}
            fallback={<span class={styles.paidBadge}>Paid</span>}
          >
            <button
              class={styles.payBtn}
              type="button"
              data-test-id="sub-mark-paid"
              aria-label={`Mark ${sub().name} paid`}
              title="Mark paid"
              disabled={isPaying()}
              onClick={() => {
                props.onMarkPaid(sub().id)
              }}
            >
              <Show
                when={!isPaying()}
                fallback={
                  <svg
                    class={styles.spin}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path d="M12 3a9 9 0 1 0 9 9" stroke-linecap="round" />
                  </svg>
                }
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="m8.5 12.2 2.4 2.4 4.6-4.9" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </Show>
            </button>
          </Show>

          <OverflowMenu
            label={`More actions for ${sub().name}`}
            items={[
              {
                label: isActive() ? 'Pause' : 'Resume',
                icon: () =>
                  isActive() ? (
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path d="M9 5v14M15 5v14" stroke-linecap="round" />
                    </svg>
                  ) : (
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path d="M7 5.5v13l11-6.5z" stroke-linejoin="round" />
                    </svg>
                  ),
                onSelect: () => {
                  props.onPause(sub().id)
                },
              },
              {
                label: 'Edit',
                icon: () => (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path
                      d="M16.5 4.5l3 3L8 19l-4 1 1-4z"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                ),
                onSelect: () => {
                  props.onEdit(sub().id)
                },
              },
              {
                label: 'Delete',
                danger: true,
                icon: () => (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                ),
                onSelect: () => {
                  void confirmDelete()
                },
              },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
