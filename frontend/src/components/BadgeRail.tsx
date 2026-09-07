/**
 * The everyday touchpoint: the badges this profile has earned, newest first, scrolling
 * sideways, with a way through to the Progress page. Before the first badge it says what will
 * appear rather than showing an empty strip.
 */
import { createMemo, For, Show } from 'solid-js'
import { achievementById } from '../core/achievements/definitions'
import { streak, unlocks } from '../core/achievementsStore'
import { setPage } from '../core/appStore'
import BadgeMedallion from './BadgeMedallion'
import styles from './BadgeRail.module.css'
import type { JSX } from 'solid-js'

export const streakLabel = (n: number): string =>
  n === 0 ? 'Start a streak' : n === 1 ? '1 month tracked' : `${n} months tracked`

const monthLabel = (ymd: string): string =>
  new Date(`${ymd.slice(0, 7)}-15T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

export default function BadgeRail(): JSX.Element {
  // Newest first: the badge just earned is the one worth seeing.
  const earned = createMemo(() =>
    [...unlocks()].sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt))
  )
  const open = (): void => {
    setPage('progress')
  }
  return (
    <section class={styles.rail} data-test-id="badge-rail" aria-label="Badges">
      <div class={styles.head}>
        <span class={styles.streak}>{streakLabel(streak())}</span>
        <button type="button" class={styles.seeAll} onClick={open} data-test-id="badges-see-all">
          See all
        </button>
      </div>
      <Show
        when={earned().length > 0}
        fallback={
          <p class={styles.empty} data-test-id="badge-rail-empty">
            Your first badge lands after three entries in a month.
          </p>
        }
      >
        <ul
          class={styles.shelf}
          tabindex="0"
          aria-label="Badges earned. Scroll sideways to browse."
        >
          <For each={earned()}>
            {(rec) => {
              const def = achievementById(rec.id)
              return (
                <li class={styles.item} data-rail-item>
                  <button type="button" class={styles.itemButton} onClick={open}>
                    <BadgeMedallion
                      id={def.id}
                      band={def.band}
                      size={44}
                      interactive
                      label={`${def.name}: ${def.rule}`}
                    />
                    <span class={styles.name}>{def.name}</span>
                    <span class={styles.when}>{monthLabel(rec.earnedOn)}</span>
                  </button>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
    </section>
  )
}
