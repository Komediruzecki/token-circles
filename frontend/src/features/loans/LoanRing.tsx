/**
 * The share of a loan already repaid, as a ring: the orbit meaning "progress" (plan 01). The ring
 * is decoration for the eye; the words beside it are what a screen reader reads.
 */
import styles from './Loans.module.css'

const SIZE = 48
const STROKE = 5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function LoanRing(props: { share: number; testId?: string }) {
  const share = () => Math.min(1, Math.max(0, props.share || 0))
  return (
    <svg
      class={styles.ring}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
      data-test-id={props.testId}
    >
      <circle
        class={styles.ringTrack}
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke-width={STROKE}
      />
      <circle
        class={styles.ringFill}
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke-width={STROKE}
        stroke-linecap={share() > 0 && share() < 1 ? 'round' : 'butt'}
        stroke-dasharray={`${CIRCUMFERENCE * share()} ${CIRCUMFERENCE}`}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </svg>
  )
}
