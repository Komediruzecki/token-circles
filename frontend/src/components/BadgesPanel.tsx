/**
 * The occasional touchpoint: three bands, earned badges lit, the next one in each band named.
 * Opened from the dashboard chip, the unlock toast and Settings > About.
 */
import { For, Show } from 'solid-js'
import { ACHIEVEMENTS, BANDS } from '../core/achievements/definitions'
import { monthsTo } from '../core/achievements/evaluate'
import { shareBadge } from '../core/achievements/shareCard'
import { closeBadgesPanel, panelOpen, streak, unlocks } from '../core/achievementsStore'
import { addToast } from '../core/toastStore'
import BadgeMedallion from './BadgeMedallion'
import styles from './BadgesPanel.module.css'
import type { JSX } from 'solid-js'
import type { AchievementDef, AchievementId, Band } from '../core/achievements/definitions'

const STREAK_TARGET: Partial<Record<AchievementId, number>> = {
  'one-month': 1,
  'a-quarter': 3,
  'half-a-year': 6,
  'a-year': 12,
  'two-years': 24,
}

const monthName = (ymd: string): string =>
  new Date(`${ymd.slice(0, 7)}-15T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

const nextCopy = (next: AchievementDef, live: number): string => {
  const target = STREAK_TARGET[next.id]
  if (target === undefined) return `Next: ${next.name}`
  const left = monthsTo(live, target)
  if (left === 0) return `Next: ${next.name}` // reached, awaiting the next evaluation
  return `Next: ${next.name}, ${left} more tracked ${left === 1 ? 'month' : 'months'}`
}

export default function BadgesPanel(): JSX.Element {
  const earned = () => new Map(unlocks().map((u) => [u.id, u]))
  const nextIn = (band: Band): AchievementDef | undefined =>
    ACHIEVEMENTS.find((a) => a.band === band && !earned().has(a.id))
  const share = async (a: AchievementDef): Promise<void> => {
    try {
      const how = await shareBadge(a.id)
      if (how === 'downloaded') {
        addToast('Share card saved as a PNG.', 'success', { channel: 'achievements' })
      }
    } catch {
      addToast('Could not build the share card.', 'error', { channel: 'achievements' })
    }
  }
  return (
    <Show when={panelOpen()}>
      <div class={styles.overlay} onClick={closeBadgesPanel} data-test-id="badges-panel">
        <div
          class={styles.panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="badges-title"
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <header class={styles.head}>
            <div>
              <h2 id="badges-title" class={styles.title}>
                Badges
              </h2>
              <p class={styles.sub}>
                {streak() === 1 ? '1 month tracked so far.' : `${streak()} months tracked so far.`}
              </p>
            </div>
            <button
              type="button"
              class={styles.close}
              onClick={closeBadgesPanel}
              aria-label="Close"
            >
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  fill="none"
                />
              </svg>
            </button>
          </header>
          <For each={Object.keys(BANDS) as Band[]}>
            {(band) => (
              <section class={styles.band}>
                <div class={styles.bandHead}>
                  <h3 class={styles.bandTitle}>{BANDS[band].label}</h3>
                  <Show when={nextIn(band)}>
                    {(next) => <span class={styles.next}>{nextCopy(next(), streak())}</span>}
                  </Show>
                </div>
                <ul class={styles.grid}>
                  <For each={ACHIEVEMENTS.filter((a) => a.band === band)}>
                    {(a) => {
                      const rec = () => earned().get(a.id)
                      return (
                        <li class={styles.card}>
                          <BadgeMedallion
                            id={a.id}
                            band={a.band}
                            size={104}
                            lit={rec() !== undefined}
                            interactive={rec() !== undefined}
                            label={`${a.name}: ${a.rule}`}
                          />
                          <div class={styles.name}>{a.name}</div>
                          <p class={styles.rule}>
                            {rec() ? `Earned ${monthName(rec()!.earnedOn)}` : a.rule}
                          </p>
                          <Show when={rec()}>
                            <button
                              type="button"
                              class={styles.share}
                              onClick={() => {
                                void share(a)
                              }}
                            >
                              Share
                            </button>
                          </Show>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </section>
            )}
          </For>
          <p class={styles.privacy}>
            Badges are worked out from this profile's data, on this device. Nothing leaves this
            device unless you tap Share.
          </p>
        </div>
      </div>
    </Show>
  )
}
