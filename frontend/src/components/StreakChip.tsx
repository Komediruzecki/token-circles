import { openBadgesPanel, streak } from '../core/achievementsStore'
import BadgeMedallion from './BadgeMedallion'
import styles from './BadgesPanel.module.css'
import type { JSX } from 'solid-js'

export const streakLabel = (n: number): string =>
  n === 0 ? 'Start a streak' : n === 1 ? '1 month tracked' : `${n} months tracked`

/** The everyday touchpoint: the live streak, tapping opens the badges panel. */
export default function StreakChip(): JSX.Element {
  return (
    <button
      type="button"
      class={styles.chip}
      onClick={openBadgesPanel}
      data-test-id="streak-chip"
      title="Badges"
    >
      <BadgeMedallion
        id={streak() >= 3 ? 'a-quarter' : 'one-month'}
        band="building"
        size={22}
        lit={streak() > 0}
        label=""
      />
      <span>{streakLabel(streak())}</span>
    </button>
  )
}
