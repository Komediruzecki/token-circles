/**
 * TourSelectionModal — Lets users choose which spotlight tour to take
 */
import { createMemo, For } from 'solid-js'
import { startOnboarding } from '../core/onboardingStore'
import {
  getCompletedCount,
  getTotalTourCount,
  isTourCompleted,
  resetAllTours,
  setShowTourSelection,
  SPOTLIGHT_TOURS,
  startFullTour,
  startTour,
} from '../core/spotlightStore'
import styles from './TourSelectionModal.module.css'

export default function TourSelectionModal() {
  const completedCount = createMemo(() => getCompletedCount())
  const totalCount = createMemo(() => getTotalTourCount())

  return (
    <div class={styles.overlay} onClick={() => setShowTourSelection(false)}>
      <div
        class={styles.modal}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <div class={styles.header}>
          <div>
            <h2>Take a Tour</h2>
            <p>
              {completedCount()}/{totalCount()} tours completed
            </p>
          </div>
          <button
            class={styles.closeBtn}
            onClick={() => {
              setShowTourSelection(false)
            }}
          >
            <svg
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class={styles.body}>
          {/* Setup wizard relaunch */}
          <button
            class={styles.fullTourBtn}
            data-test-id="tour-open-onboarding"
            onClick={() => {
              setShowTourSelection(false)
              startOnboarding()
            }}
          >
            <svg
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="2.6" />
              <circle cx="19" cy="6" r="1.3" fill="currentColor" stroke="none" />
            </svg>
            Run the Setup Wizard (accounts, imports, subscriptions)
          </button>

          {/* Full Tour */}
          <button class={styles.fullTourBtn} onClick={startFullTour}>
            <svg
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.86L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            Take Full Tour (All {totalCount()} pages)
          </button>

          {/* Individual Tours */}
          <div class={styles.tourGrid}>
            <For each={SPOTLIGHT_TOURS}>
              {(tour) => {
                const completed = isTourCompleted(tour.id)
                return (
                  <button
                    class={styles.tourCard}
                    classList={{ [styles.completed]: completed }}
                    onClick={() => {
                      startTour(tour.id)
                    }}
                  >
                    <span class={styles.tourLabel}>{tour.label}</span>
                    <span class={styles.tourBadge}>
                      {completed ? 'Done' : `${tour.steps.length} steps`}
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>

        <div class={styles.footer}>
          <button
            class={styles.resetBtn}
            onClick={() => {
              resetAllTours()
              setShowTourSelection(false)
            }}
          >
            Reset All Tours
          </button>
        </div>
      </div>
    </div>
  )
}
