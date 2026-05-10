/**
 * Savings Rate Card Component
 * Shows current savings rate for the period with goal tracking
 */
import { createSignal } from 'solid-js'
import { formatCurrency } from '../../core/api'
import styles from './SavingsRateCard.module.css'

export interface SavingsRateCardProps {
  savingsRate: number
  monthlySavings: number
  goal: number
  onGoalChange: (value: number) => void
}

export default function SavingsRateCard(props: SavingsRateCardProps) {
  const [goalInput, setGoalInput] = createSignal('')

  const rateColor = () => {
    const rate = props.savingsRate
    if (rate >= 20) return styles.rateGood
    if (rate >= 10) return styles.rateWarning
    return styles.rateBad
  }

  const goalStatus = () => {
    return props.savingsRate >= props.goal ? styles.goalMet : styles.goalUnder
  }

  const handleSetGoal = () => {
    const num = parseFloat(goalInput())
    if (!isNaN(num) && num >= 0 && num <= 100) {
      props.onGoalChange(num)
      setGoalInput('')
    }
  }

  return (
    <div class={styles.card}>
      <div class={styles.savingsRateContainer}>
        <div class={styles.savingsRateValue}>
          <span class={styles.rateLabel}>Period Savings:</span>
          <span
            class={`${styles.rateValue} ${props.monthlySavings >= 0 ? styles.rateGood : styles.rateBad}`}
          >
            {formatCurrency(props.monthlySavings)}
          </span>
        </div>

        <div class={styles.rateDivider} />

        <div class={styles.savingsRateValue}>
          <span class={styles.rateLabel}>Savings Rate:</span>
          <span class={`${styles.rateValue} ${rateColor()}`}>{props.savingsRate.toFixed(1)}%</span>
        </div>

        <div class={styles.goalSection}>
          <div class={styles.goalInfo}>
            <span class={styles.rateLabel}>Goal: {props.goal}%</span>
            <span class={`${styles.goalStatus} ${goalStatus()}`}>
              {props.savingsRate >= props.goal
                ? 'Goal met'
                : `${(props.goal - props.savingsRate).toFixed(1)}% to go`}
            </span>
          </div>
          <div class={styles.goalBar}>
            <div
              class={styles.goalBarFill}
              style={{
                width: `${props.goal > 0 ? Math.min((props.savingsRate / props.goal) * 100, 100) : 0}%`,
              }}
            />
          </div>
          <div class={styles.goalInput}>
            <input
              type="number"
              class={styles.goalInputField}
              placeholder="New goal %"
              min="0"
              max="100"
              value={goalInput()}
              onInput={(e) => setGoalInput(e.currentTarget.value)}
            />
            <button class={styles.goalButton} onClick={handleSetGoal}>
              Set Goal
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
