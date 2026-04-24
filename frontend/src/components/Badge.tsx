/**
 * Badge Component - Reusable badge component with status variants
 */

import { JSX, mergeProps } from 'solid-js'

interface BadgeProps {
  status?: 'ok' | 'warning' | 'over' | 'income' | 'expense' | 'transfer' | 'default'
  children: JSX.Element
  class?: string
}

export default function Badge(props: BadgeProps) {
  const merged = mergeProps({ status: 'default' }, props)

  const baseClass = 'badge'
  const statusClass = merged.status !== 'default' ? `badge-${merged.status}` : ''

  return (
    <span class={`${baseClass} ${statusClass} ${merged.class || ''}`.trim()}>
      {merged.children}
    </span>
  )
}
