/**
 * Period Navigator Component
 * Navigation for month/year selection in dashboard
 */
import { createSignal, For, Show } from 'solid-js'
import styles from './PeriodNavigator.module.css'

export interface PeriodNavigatorProps {
  month: () => number
  year: () => number
  onMonthChange: (newMonth: number) => void
  onYearChange: (newYear: number) => void
  onPrev: () => void
  onNext: () => void
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function PeriodNavigator(props: PeriodNavigatorProps) {
  const [showMonthPicker, setShowMonthPicker] = createSignal(false)
  const [showYearPicker, setShowYearPicker] = createSignal(false)
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 21 }, (_, i) => currentYear - 10 + i)

  return (
    <div class={styles.periodNavigator}>
      <button
        class={styles.prevButton}
        onClick={props.onPrev}
        type="button"
        aria-label="Previous period"
      >
        <svg
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div class={styles.periodDisplay}>
        <div class={styles.dropdownWrapper}>
          <button
            class={styles.monthBtn}
            onClick={() => { setShowMonthPicker(!showMonthPicker()); setShowYearPicker(false) }}
            type="button"
          >
            {MONTHS[props.month() - 1]}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
              <path d="M5 6L0 0h10z" />
            </svg>
          </button>
          <Show when={showMonthPicker()}>
            <div class={styles.dropdown}>
              <For each={MONTHS}>
                {(name, i) => (
                  <button
                    class={styles.dropdownItem}
                    classList={{ [styles.selected]: i() + 1 === props.month() }}
                    onClick={() => {
                      props.onMonthChange(i() + 1)
                      setShowMonthPicker(false)
                    }}
                    type="button"
                  >
                    {name}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class={styles.dropdownWrapper}>
          <button
            class={styles.yearBtn}
            onClick={() => { setShowYearPicker(!showYearPicker()); setShowMonthPicker(false) }}
            type="button"
          >
            {props.year()}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor">
              <path d="M5 6L0 0h10z" />
            </svg>
          </button>
          <Show when={showYearPicker()}>
            <div class={styles.dropdown}>
              <For each={years}>
                {(y) => (
                  <button
                    class={styles.dropdownItem}
                    classList={{ [styles.selected]: y === props.year() }}
                    onClick={() => {
                      props.onYearChange(y)
                      setShowYearPicker(false)
                    }}
                    type="button"
                  >
                    {y}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      <button
        class={styles.nextButton}
        onClick={props.onNext}
        type="button"
        aria-label="Next period"
      >
        <svg
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      <Show when={showMonthPicker() || showYearPicker()}>
        <div
          class={styles.overlay}
          onClick={() => { setShowMonthPicker(false); setShowYearPicker(false) }}
        />
      </Show>
    </div>
  )
}
