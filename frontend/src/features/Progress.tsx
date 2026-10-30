/**
 * Progress — the page the circles, the badges, the record and the advice share. Everything on it
 * is worked out from the profile's own data, on this device: the achievements store already holds
 * the arrays, and the circles' store (core/guidance.ts) adds the profile's settings and holdings.
 *
 * `#progress/<n>` opens circle n in place of everything under the header (design.md 1.8, circles
 * part 2); the list stays mounted under it, hidden, so going back puts focus on that circle's row.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import BadgeMedallion from '../components/BadgeMedallion'
import { streakLabel } from '../components/BadgeRail'
import BadgeTimeline from '../components/BadgeTimeline'
import CircleLedger from '../components/guidance/CircleLedger'
import CircleView from '../components/guidance/CircleView'
import NextStepCard, { NextStepPending } from '../components/guidance/NextStepCard'
import OrbitalDivider, { OrbitalAction } from '../components/OrbitalDivider'
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
import { useGuidance } from '../core/guidance'
import { circleFromHash, circleHash, isProgressHash } from '../core/progressRoute'
import { spotlightActive, spotlightStep, tourSteps } from '../core/spotlightStore'
import { addToast } from '../core/toastStore'
import { localToday } from '../utils/period'
import AdviceList from './ProgressAdvice'
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

export default function Progress(): JSX.Element {
  const snap = () => snapshot()
  const guidance = useGuidance('progress')

  /** The circle open in place of the page, from the address. */
  const [opened, setOpened] = createSignal(circleFromHash(window.location.hash))
  let root: HTMLDivElement | undefined
  onMount(() => {
    const onHashChange = () => {
      // Another page's address leaves Progress as it was, for when it is next on screen.
      if (!isProgressHash(window.location.hash)) return
      const before = opened()
      const next = circleFromHash(window.location.hash)
      setOpened(next)
      if (before !== null && next === null && !spotlightActive()) {
        // Back on the list: focus the row of the circle that was open. Not under a tour, where
        // the row's link would take Enter from the tour and open the circle again.
        queueMicrotask(() => {
          root
            ?.querySelector<HTMLAnchorElement>(`[data-circle-row="${before}"] a`)
            ?.focus({ preventScroll: false })
        })
      }
    }
    window.addEventListener('hashchange', onHashChange)
    onCleanup(() => {
      window.removeEventListener('hashchange', onHashChange)
    })
  })
  const closeCircle = () => {
    window.location.hash = circleHash(null)
  }
  // A tour of this page points at the list: take it there from a circle's view.
  createEffect(() => {
    if (!spotlightActive()) return
    const step = tourSteps()[spotlightStep()]
    if (step?.requiredPage === 'progress' && opened() !== null) closeCircle()
  })
  const tracked = createMemo(() => new Set(snap()?.evaluation.trackedMonths ?? []))
  const earned = createMemo(() => new Map(unlocks().map((u) => [u.id, u])))

  /** The last twelve months, oldest first, each with the entries it holds. */
  const strip = createMemo(() => {
    const today = snap()?.today ?? localToday()
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
        money: (n) => formatCurrency(n),
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

  /** Where focus goes when the last card of advice is dismissed. */
  let empty: HTMLParagraphElement | undefined

  const categoryName = (id: number): string =>
    snap()?.categories.find((c) => c.id === id)?.name ?? 'Uncategorised'

  return (
    <div class={styles.page} ref={root}>
      <div class={styles.pageHeader}>
        <h1 data-test-id="progress-header" data-tour="progress-header">
          Progress
        </h1>
        <p class={styles.subtitle}>
          Your circles, your record and your badges, worked out from your own numbers.
        </p>
      </div>

      <Show when={opened()} keyed>
        {(circle) => <CircleView circle={circle} view={guidance()} onClose={closeCircle} />}
      </Show>

      <div hidden={opened() !== null} data-test-id="progress-list">
        <div
          class={styles.nextStep}
          data-tour="progress-next-step"
          data-test-id="progress-next-step"
        >
          <Show when={guidance()} fallback={<NextStepPending />}>
            {(view) => <NextStepCard step={view().next} view={view()} />}
          </Show>
        </div>

        <CircleLedger view={guidance()} />

        <section class={styles.card} aria-labelledby="record-title">
          <div class={styles.recordHead}>
            <div>
              <h2 id="record-title" class={styles.streak} data-test-id="progress-streak">
                {streakLabel(streak())}
              </h2>
              <p class={styles.hint}>
                A month counts once it holds three entries. The current one may still be in
                progress.
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

        <section class={styles.section} aria-label="Worth a look">
          <OrbitalDivider
            id="progress-sec-advice"
            testId="progress-divider-advice"
            label="Worth a look"
            actions={
              dismissedAdvice().length > 0 ? (
                <OrbitalAction
                  onClick={() => {
                    void restoreAdvice()
                  }}
                >
                  Restore dismissed
                </OrbitalAction>
              ) : undefined
            }
          />
          <Show
            when={advice().length > 0}
            fallback={
              <p class={styles.empty} data-test-id="advice-empty" ref={empty} tabIndex={-1}>
                Nothing needs your attention this month.
              </p>
            }
          >
            <AdviceList
              cards={advice()}
              onOpen={(page) => {
                setPage(page as PageName)
              }}
              onDismiss={(id) => {
                void dismissAdvice(id)
              }}
              onEmpty={() => empty?.focus()}
            />
          </Show>
        </section>

        {/* Prints, phase 4 (design.md 6, circles part 2): their own section under an OrbitalDivider
          "Prints", anchors data-test-id and data-tour "progress-prints", shown once the profile has
          12 tracked months in a row or holds a pressed print. Until then, nothing. */}

        <section class={styles.section} aria-label="What you have earned">
          <OrbitalDivider
            id="progress-sec-earned"
            testId="progress-divider-earned"
            label="What you have earned"
            meta={`${unlocks().length} of ${ACHIEVEMENTS.length}`}
          />
          <BadgeTimeline />
        </section>

        <section class={styles.section} aria-label="Every badge">
          <OrbitalDivider
            id="progress-sec-badges"
            testId="progress-divider-badges"
            label="Every badge"
            meta="Earned first, then what is left"
          />
          <For each={Object.keys(BANDS) as Band[]}>
            {(band) => (
              <div class={styles.band}>
                <div class={styles.bandHead}>
                  <h3>{BANDS[band].label}</h3>
                  <span class={styles.bandRule} aria-hidden="true" />
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
    </div>
  )
}
