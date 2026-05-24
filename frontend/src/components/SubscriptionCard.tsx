/**
 * SubscriptionCard — Beautiful branded card for subscription items.
 *
 * Follows the Categories page card pattern:
 * - Brand-colored icon box (40x40, rounded)
 * - Name + amount row
 * - Due countdown with contextual styling
 * - Category pill badge
 * - Hover-revealed action buttons
 */

/** @jsxImportSource solid-js */
import { Show } from 'solid-js'
import { formatCurrency } from '../core/api'
import { matchBrand } from '../features/subscriptionBrands'
import ConfirmButton from './ConfirmButton'
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
  const brand = () =>
    matchBrand(sub().name, sub().category_color)
  const isActive = () => sub().is_active !== 0
  const isPaying = () => props.markingPaid().has(sub().id)
  const categoryLabel = () => sub().category_name || sub().category || brand().defaultCategory

  return (
    <div class={`${styles.card} ${!isActive() ? styles.paused : ''}`}>
      {/* Top accent border color */}
      <div class={styles.accent} style={{ 'background-color': brand().color }} />

      {/* Header: icon + info */}
      <div class={styles.header}>
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
          <h4 class={styles.name}>{brand().displayName || sub().name}</h4>
          <p class={styles.meta}>
            {sub().name !== brand().displayName && brand().displayName ? sub().name : ''}
          </p>
        </div>
        <div class={styles.amount}>
          <span class={styles.amountValue}>{formatCurrency(sub().amount)}</span>
          <span class={styles.frequency}>
            /{sub().frequency === 'monthly' ? 'mo' : sub().frequency === 'weekly' ? 'wk' : 'biwk'}
          </span>
        </div>
      </div>

      {/* Meta row: due date + category */}
      <div class={styles.metaRow}>
        <span class={`${styles.due} ${dueClass(sub().due_date)}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {dueText(sub().due_date)}
          {' · '}
          {formatDate(sub().due_date)}
        </span>
        <span class={styles.categoryPill} style={{ 'background-color': brand().bgColor, color: brand().color }}>
          {categoryLabel()}
        </span>
      </div>

      {/* Status badge */}
      <div class={styles.statusRow}>
        <Show when={sub().paid}>
          <span class={styles.paidBadge}>Paid</span>
        </Show>
        <Show when={!isActive()}>
          <span class={styles.pausedBadge}>Paused</span>
        </Show>
      </div>

      {/* Hover-revealed actions */}
      <div class={styles.actions}>
        <button
          class={`${styles.actionBtn} ${styles.actionPrimary}`}
          onClick={() => { props.onMarkPaid(sub().id); }}
          disabled={isPaying()}
        >
          {isPaying() ? 'Paying...' : 'Mark Paid'}
        </button>
        <Show when={isActive()} fallback={
          <button
            class={`${styles.actionBtn} ${styles.actionPrimary}`}
            onClick={() => { props.onPause(sub().id); }}
            title="Resume subscription"
          >
            Resume
          </button>
        }>
          <button
            class={`${styles.actionBtn} ${styles.actionGhost}`}
            onClick={() => { props.onPause(sub().id); }}
            title="Pause subscription"
          >
            Pause
          </button>
        </Show>
        <button
          class={`${styles.actionBtn} ${styles.actionGhost}`}
          onClick={() => { props.onEdit(sub().id); }}
          title="Edit subscription"
        >
          Edit
        </button>
        <ConfirmButton
          class={`${styles.actionBtn} ${styles.actionGhost}`}
          onConfirm={() => { props.onDelete(sub().id); }}
          label="Delete"
        />
      </div>
    </div>
  )
}
