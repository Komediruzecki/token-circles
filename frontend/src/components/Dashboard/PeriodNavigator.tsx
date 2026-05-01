/**
 * Period Navigator Component
 * Navigation for month/year selection in dashboard
 */
import styles from './PeriodNavigator.module.css'

export interface PeriodNavigatorProps {
  month: () => number
  year: () => number
  onMonthChange: (newMonth: number) => void
  onYearChange: (newYear: number) => void
  onPrev: () => void
  onNext: () => void
}

export function PeriodNavigator(props: PeriodNavigatorProps) {
  return (
    <div class={styles.periodNavigator}>
      <button
        class={styles.prevButton}
        onClick={props.onPrev}
        type="button"
        aria-label="Previous period"
      >
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div class={styles.periodDisplay}>
        <span class={styles.month}>{props.month()}</span>
        <span class={styles.year}>{props.year()}</span>
      </div>

      <button
        class={styles.nextButton}
        onClick={props.onNext}
        type="button"
        aria-label="Next period"
      >
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}
