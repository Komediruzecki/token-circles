/**
 * When the badges were earned, in order, as one horizontal strip.
 *
 * The gallery below answers "what is there to get". This answers "what have I done", which is a
 * different question and the one a person comes back for. Entries are grouped by the month the
 * rule was met — not by the day the app noticed — so importing five years of statements reads as
 * five years of history rather than as one very busy afternoon.
 */
import { createMemo, For, onCleanup, Show } from 'solid-js'
import { achievementById } from '../core/achievements/definitions'
import { unlocks } from '../core/achievementsStore'
import { scrollHorizontallyOnWheel } from '../utils/horizontalWheel'
import BadgeMedallion from './BadgeMedallion'
import styles from './BadgeTimeline.module.css'
import type { JSX } from 'solid-js'
import type { UnlockRecord } from '../core/achievements/records'

const monthLabel = (ymd: string): string =>
  new Date(`${ymd.slice(0, 7)}-15T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

interface Stop {
  month: string
  records: UnlockRecord[]
}

/** Oldest first: a timeline reads forwards, and the newest end is where the scroller starts. */
export function groupByMonth(records: UnlockRecord[]): Stop[] {
  const byMonth = new Map<string, UnlockRecord[]>()
  for (const r of records) {
    const m = r.earnedOn.slice(0, 7)
    const list = byMonth.get(m)
    if (list) list.push(r)
    else byMonth.set(m, [r])
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => ({ month, records: list }))
}

export default function BadgeTimeline(): JSX.Element {
  const stops = createMemo(() => groupByMonth(unlocks()))
  return (
    <Show
      when={stops().length > 0}
      fallback={
        <p class={styles.empty} data-test-id="timeline-empty">
          Your first badge will appear here, dated to the month you earned it.
        </p>
      }
    >
      <ol
        class={`${styles.track} brand-scroll`}
        ref={(el) => {
          onCleanup(scrollHorizontallyOnWheel(el))
        }}
        data-test-id="badge-timeline"
        tabindex="0"
        aria-label="Badges earned, oldest first. Scroll sideways to browse."
      >
        <For each={stops()}>
          {(stop) => (
            <li class={styles.stop} data-timeline-stop={stop.month}>
              <div class={styles.when}>{monthLabel(stop.month)}</div>
              <div class={styles.dot} aria-hidden="true" />
              <div class={styles.medals}>
                <For each={stop.records}>
                  {(rec) => {
                    const def = achievementById(rec.id)
                    return (
                      <div class={styles.medal}>
                        <BadgeMedallion id={def.id} band={def.band} size={56} interactive />
                        <span class={styles.name}>{def.name}</span>
                      </div>
                    )
                  }}
                </For>
              </div>
            </li>
          )}
        </For>
      </ol>
    </Show>
  )
}
