/**
 * Period Pills Component
 * Quick-select period buttons for dashboard
 */
import periodPillsStyles from './PeriodPills.module.css'

export interface PeriodPill {
  id: string
  label: string
  icon?: string
}

export interface PeriodPillsProps {
  value: string
  onChange: (period: string) => void
  periods?: PeriodPill[]
}

const DEFAULT_PERIODS: PeriodPill[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'quarter', label: 'This Quarter' },
  { id: 'year', label: 'This Year' },
  { id: 'last7', label: 'Last 7 Days' },
  { id: 'last30', label: 'Last 30 Days' },
  { id: 'last90', label: 'Last 90 Days' },
]

export function PeriodPills(props: PeriodPillsProps) {
  const periods = props.periods || DEFAULT_PERIODS

  return (
    <div class={periodPillsStyles.pillsContainer}>
      {periods.map((period) => (
        <button
          key={period.id}
          class={`${periodPillsStyles.pill} ${props.value === period.id ? periodPillsStyles.pillActive : ''}`}
          onClick={() => { props.onChange(period.id); }}
          type="button"
        >
          {period.icon && (
            <span class={periodPillsStyles.pillIcon}>{period.icon}</span>
          )}
          <span class={periodPillsStyles.pillLabel}>{period.label}</span>
        </button>
      ))}
    </div>
  )
}

export default function PeriodPillsDefault(props: PeriodPillsProps) {
  return <PeriodPills {...props} />
}
