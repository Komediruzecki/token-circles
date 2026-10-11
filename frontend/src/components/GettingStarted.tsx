/**
 * Getting started: the next steps the person's own data says are worth taking
 * (shared/orientation.ts), on the setup wizard's last step and as a card on Dashboard. Each step
 * says why in their counts and months, and links to the page where it is done.
 *
 * The steps come from the last badge evaluation (achievementsStore's snapshot), which follows
 * every data change in both storage modes, so a step goes once it is done. The card shows while the
 * account has a Getting started record that is not hidden (core/gettingStarted.ts) and a step
 * applies.
 */
import { createMemo, For, onMount, Show } from 'solid-js'
import { nextSteps } from '../../../shared/orientation'
import { snapshot } from '../core/achievementsStore'
import {
  gettingStartedRecord,
  hideGettingStarted,
  loadGettingStarted,
} from '../core/gettingStarted'
import { orientationFacts } from '../core/orientation'
import styles from './GettingStarted.module.css'
import type { JSX } from 'solid-js'
import type { OrientationStep } from '../../../shared/orientation'

/** The steps to show now, from the last badge evaluation; none before one has run. */
export function currentNextSteps(): OrientationStep[] {
  const snap = snapshot()
  return snap === null ? [] : nextSteps(orientationFacts(snap, Date.now()))
}

const ArrowIcon = (): JSX.Element => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

const CloseIcon = (): JSX.Element => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path
      d="M4 4l8 8M12 4l-8 8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  </svg>
)

/** The steps, in order, each a link to its page. `onFollow` runs as a link is followed. */
export function NextSteps(props: {
  steps: OrientationStep[]
  onFollow?: (step: OrientationStep) => void
}): JSX.Element {
  return (
    <ol class={styles.steps} data-test-id="next-steps">
      <For each={props.steps}>
        {(step) => (
          <li class={styles.step} data-test-id="next-step" data-step={step.id}>
            <a
              class={styles.link}
              href={step.link.hash}
              data-test-id="next-step-link"
              onClick={() => props.onFollow?.(step)}
            >
              <span class={styles.title}>{step.title}</span>
              <span class={styles.page}>
                {step.link.label}
                <ArrowIcon />
              </span>
            </a>
            <p class={styles.reason} data-test-id="next-step-reason">
              {step.reason}
            </p>
          </li>
        )}
      </For>
    </ol>
  )
}

/** Dashboard's Getting started card. */
export function GettingStartedCard(): JSX.Element {
  onMount(() => {
    void loadGettingStarted()
  })
  const steps = createMemo(currentNextSteps)
  const shown = () => gettingStartedRecord()?.hidden === false && steps().length > 0
  return (
    <Show when={shown()}>
      <section
        class={styles.card}
        data-test-id="getting-started"
        aria-labelledby="getting-started-title"
      >
        <header class={styles.head}>
          <div>
            <h3 id="getting-started-title" class={styles.heading}>
              Getting started
            </h3>
            <p class={styles.lead}>From your own entries, so they change as you go.</p>
          </div>
          <button
            type="button"
            class={styles.hide}
            data-test-id="getting-started-hide"
            onClick={() => {
              hideGettingStarted()
            }}
          >
            <CloseIcon />
            Hide
          </button>
        </header>
        <NextSteps steps={steps()} />
      </section>
    </Show>
  )
}
