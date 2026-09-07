/**
 * Progress — the page the badges, the record and the advice share. Everything on it is worked
 * out from the profile's own data, on this device: the achievements store already holds the
 * arrays, so nothing here fetches and nothing here leaves the machine.
 */
import { createMemo, For, Show } from 'solid-js'
import BadgeMedallion from '../components/BadgeMedallion'
import BadgeTimeline from '../components/BadgeTimeline'
import { buildAdvice } from '../core/achievements/advice'
import { ACHIEVEMENTS, BANDS } from '../core/achievements/definitions'
import { monthsTo } from '../core/achievements/evaluate'
import { addMonths, monthOf } from '../core/achievements/months'
import { buildYearReview } from '../core/achievements/review'
import { shareBadge } from '../core/achievements/shareCard'
import {
  dismissAdvice,
  dismissedAdvice,
  restoreAdvice,
  snapshot,
  streak,
  unlocks,
} from '../core/achievementsStore'
import { formatCurrency } from '../core/api'
import { setPage } from '../core/appStore'
import { addToast } from '../core/toastStore'
import styles from './ProgressPage.module.css'
import type { JSX } from 'solid-js'
import type { AdviceCard } from '../core/achievements/advice'
import type { AchievementDef, AchievementId, Band } from '../core/achievements/definitions'
import type { PageName } from '../types/models'

const STREAK_TARGET: Partial<Record<AchievementId, number>> = {
  'one-month': 1,
  'a-quarter': 3,
  'half-a-year': 6,
  'a-year': 12,
  'two-years': 24,
}

const monthLabel = (ym: string): string =>
  new Date(`${ym}-15T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

const monthInitial = (ym: string): string =>
  new Date(`${ym}-15T00:00:00Z`).toLocaleDateString(undefined, { month: 'narrow', timeZone: 'UTC' })

const IconDismiss = (): JSX.Element => (
  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
    <path
      d="M5 5l10 10M15 5L5 15"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      fill="none"
    />
  </svg>
)

export default function Progress(): JSX.Element {
  const snap = () => snapshot()
  const tracked = createMemo(() => new Set(snap()?.evaluation.trackedMonths ?? []))
  const earned = createMemo(() => new Map(unlocks().map((u) => [u.id, u])))

  /** The last twelve months, oldest first, each with the entries it holds. */
  const strip = createMemo(() => {
    const today = snap()?.today ?? new Date().toISOString().slice(0, 10)
    const counts = new Map<string, number>()
    for (const t of snap()?.transactions ?? []) {
      const m = monthOf(t.date)
      counts.set(m, (counts.get(m) ?? 0) + 1)
    }
    const now = monthOf(today)
    return Array.from({ length: 12 }, (_, i) => {
      const month = addMonths(now, i - 11)
      return { month, entries: counts.get(month) ?? 0, tracked: tracked().has(month) }
    })
  })

  const advice = createMemo<AdviceCard[]>(() => {
    const s = snap()
    if (!s) return []
    return buildAdvice(
      {
        transactions: s.transactions,
        budgets: s.budgets,
        goals: s.goals,
        importLogs: s.importLogs,
        loans: s.loans,
        categories: s.categories,
        bills: s.bills,
        selfHosted: false,
        today: s.today,
        dismissed: dismissedAdvice(),
      },
      streak()
    )
  })

  const review = createMemo(() => {
    const s = snap()
    return s ? buildYearReview({ transactions: s.transactions, today: s.today }) : null
  })

  const nextIn = (band: Band): AchievementDef | undefined =>
    ACHIEVEMENTS.find((a) => a.band === band && !earned().has(a.id))

  /**
   * Earned first inside each band, definition order otherwise. With thirty-four badges a mixed
   * grid buries the lit ones among the dim; this keeps what a person has done at the top of the
   * band they did it in, and leaves the rest below as the thing to aim at.
   */
  const inBand = (band: Band): AchievementDef[] => {
    const held = earned()
    const all = ACHIEVEMENTS.filter((a) => a.band === band)
    return [...all.filter((a) => held.has(a.id)), ...all.filter((a) => !held.has(a.id))]
  }

  const nextCopy = (next: AchievementDef): string => {
    const target = STREAK_TARGET[next.id]
    if (target === undefined) return `Next: ${next.name}`
    const left = monthsTo(streak(), target)
    if (left === 0) return `Next: ${next.name}`
    return `Next: ${next.name}, ${left} more tracked ${left === 1 ? 'month' : 'months'}`
  }

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

  const categoryName = (id: number): string =>
    snap()?.categories.find((c) => c.id === id)?.name ?? 'Uncategorised'

  return (
    <div class={styles.page}>
      <div class={styles.pageHeader}>
        <h1 data-test-id="progress-header" data-tour="progress-header">
          Progress
        </h1>
        <p class={styles.subtitle}>
          Your record, your badges, and what your own numbers say is worth a look.
        </p>
      </div>

      <section class={styles.card} aria-labelledby="record-title">
        <div class={styles.recordHead}>
          <div>
            <h2 id="record-title" class={styles.streak} data-test-id="progress-streak">
              {streak() === 1 ? '1 month tracked' : `${streak()} months tracked`}
            </h2>
            <p class={styles.hint}>
              A month counts once it holds three entries. The current one may still be in progress.
            </p>
          </div>
        </div>
        <ol class={styles.strip} aria-label="The last twelve months">
          <For each={strip()}>
            {(cell) => (
              <li
                class={styles.cell}
                data-month-cell
                data-tracked={cell.tracked ? 'true' : 'false'}
                title={`${monthLabel(cell.month)}: ${cell.entries} ${cell.entries === 1 ? 'entry' : 'entries'}`}
              >
                <span class={styles.cellMark} aria-hidden="true" />
                <span class={styles.cellLabel}>{monthInitial(cell.month)}</span>
              </li>
            )}
          </For>
        </ol>
      </section>

      <section class={styles.section} aria-labelledby="advice-title">
        <div class={styles.sectionHead}>
          <h2 id="advice-title">Worth a look</h2>
          <Show when={dismissedAdvice().length > 0}>
            <button
              type="button"
              class={styles.ghost}
              onClick={() => {
                void restoreAdvice()
              }}
            >
              Restore dismissed
            </button>
          </Show>
        </div>
        <Show
          when={advice().length > 0}
          fallback={
            <p class={styles.empty} data-test-id="advice-empty">
              Nothing needs your attention this month.
            </p>
          }
        >
          <ul class={styles.advice}>
            <For each={advice()}>
              {(card) => (
                <li class={styles.adviceCard} data-tone={card.tone} data-advice-card>
                  <div class={styles.adviceBody}>
                    <div class={styles.adviceTitle}>{card.title}</div>
                    <p class={styles.adviceDetail}>{card.detail}</p>
                    <div class={styles.adviceFoot}>
                      <span class={styles.figure}>{card.figure}</span>
                      <Show when={card.link}>
                        {(link) => (
                          <button
                            type="button"
                            class={styles.ghost}
                            onClick={() => {
                              setPage(link().page as PageName)
                            }}
                          >
                            {link().label}
                          </button>
                        )}
                      </Show>
                    </div>
                  </div>
                  <button
                    type="button"
                    class={styles.dismiss}
                    aria-label={`Dismiss: ${card.title}`}
                    onClick={() => {
                      void dismissAdvice(card.id)
                    }}
                  >
                    <IconDismiss />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class={styles.section} aria-labelledby="earned-title">
        <div class={styles.sectionHead}>
          <h2 id="earned-title">What you have earned</h2>
          <span class={styles.hint}>
            {unlocks().length} of {ACHIEVEMENTS.length}
          </span>
        </div>
        <BadgeTimeline />
      </section>

      <section class={styles.section} aria-labelledby="badges-title">
        <div class={styles.sectionHead}>
          <h2 id="badges-title">Every badge</h2>
          <span class={styles.hint}>Earned first, then what is left</span>
        </div>
        <For each={Object.keys(BANDS) as Band[]}>
          {(band) => (
            <div class={styles.band}>
              <div class={styles.bandHead}>
                <h3>{BANDS[band].label}</h3>
                <Show when={nextIn(band)}>
                  {(next) => <span class={styles.next}>{nextCopy(next())}</span>}
                </Show>
              </div>
              <ul class={styles.grid}>
                <For each={inBand(band)}>
                  {(a) => {
                    const rec = () => earned().get(a.id)
                    return (
                      <li class={styles.badge}>
                        <BadgeMedallion
                          id={a.id}
                          band={a.band}
                          size={104}
                          lit={rec() !== undefined}
                          interactive={rec() !== undefined}
                          label={`${a.name}: ${a.rule}`}
                        />
                        <div class={styles.badgeName}>{a.name}</div>
                        <p class={styles.badgeRule}>
                          {rec() ? `Earned ${monthLabel(rec()!.earnedOn.slice(0, 7))}` : a.rule}
                        </p>
                        <Show when={rec()}>
                          <button
                            type="button"
                            class={styles.ghost}
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
            </div>
          )}
        </For>
        <p class={styles.privacy}>
          Badges are worked out from this profile's data, on this device. Nothing leaves it unless
          you tap Share.
        </p>
      </section>

      <Show when={review()}>
        {(r) => (
          <section class={styles.card} aria-labelledby="review-title">
            <div class={styles.sectionHead}>
              <h2 id="review-title">Year in review</h2>
              <span class={styles.hint}>{r().year}</span>
            </div>
            <dl class={styles.review}>
              <div>
                <dt>Tracked months</dt>
                <dd>{r().trackedMonths}</dd>
              </div>
              <div>
                <dt>Entries</dt>
                <dd>{r().entries}</dd>
              </div>
              <div>
                <dt>In</dt>
                <dd>{formatCurrency(r().income)}</dd>
              </div>
              <div>
                <dt>Out</dt>
                <dd>{formatCurrency(r().expenses)}</dd>
              </div>
              <div>
                <dt>Kept</dt>
                <dd data-test-id="review-saved">{formatCurrency(r().saved)}</dd>
              </div>
              <Show when={r().bestMonth}>
                {(best) => (
                  <div>
                    <dt>Best month</dt>
                    <dd>{monthLabel(best().month)}</dd>
                  </div>
                )}
              </Show>
              <Show when={r().topCategory}>
                {(top) => (
                  <div>
                    <dt>Biggest category</dt>
                    <dd>{categoryName(top().id)}</dd>
                  </div>
                )}
              </Show>
            </dl>
          </section>
        )}
      </Show>
    </div>
  )
}
