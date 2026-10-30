/**
 * One circle, opened from its row (`#progress/<n>`, design.md 1.8, circles part 2): its ring, its
 * name and one-liner, where the person is, and Your next step while it is the circle being worked
 * on. "All seven circles" and Escape both go back to the list, where Progress puts focus on this
 * circle's row; opening it puts focus on its heading.
 */
import { onMount, Show } from 'solid-js'
import { CIRCLE_NAMES } from '../../../../shared/guidance/circles'
import { CIRCLE_LINES } from '../../../../shared/guidance/ledger'
import { GUIDANCE_LINE } from '../../../../shared/guidance/questions'
import { circleHash } from '../../core/progressRoute'
import CircleGlyph from './CircleGlyph'
import ledger from './CircleLedger.module.css'
import styles from './CircleView.module.css'
import NextStepCard from './NextStepCard'
import type { JSX } from 'solid-js'
import type { CircleNumber } from '../../../../shared/guidance/circles'
import type { GuidanceView } from '../../core/guidance'

const BackIcon = (): JSX.Element => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M10 3.5 5.5 8l4.5 4.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

export interface CircleViewProps {
  circle: CircleNumber
  view: GuidanceView | null
  /** Back to the list: "All seven circles", or Escape. */
  onClose: () => void
}

export default function CircleView(props: CircleViewProps): JSX.Element {
  let heading!: HTMLHeadingElement
  const row = () => props.view?.rows[props.circle - 1]

  onMount(() => {
    heading.focus()
  })

  return (
    <section
      class={styles.view}
      aria-labelledby="circle-view-title"
      data-test-id="circle-view"
      data-circle={props.circle}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return
        e.preventDefault()
        props.onClose()
      }}
    >
      <a
        class={styles.back}
        href={circleHash(null)}
        data-test-id="circle-back"
        onClick={(e) => {
          e.preventDefault()
          props.onClose()
        }}
      >
        <BackIcon />
        All seven circles
      </a>
      <header class={styles.head}>
        <CircleGlyph
          class={styles.glyph}
          circle={props.circle}
          state={row()?.state ?? 'later'}
          measure={row()?.measure ?? null}
          months={row()?.months ?? null}
          size={52}
        />
        <div class={styles.headText}>
          <p class={styles.eyebrow}>Circle {props.circle} of 7</p>
          <h2 id="circle-view-title" class={styles.title} ref={heading} tabIndex={-1}>
            {CIRCLE_NAMES[props.circle]}
          </h2>
          <p class={styles.line}>{CIRCLE_LINES[props.circle]}</p>
        </div>
        <Show when={row()}>
          {(r) => (
            <span class={`${ledger.pill} ${styles.pill}`} data-state={r().state}>
              {r().pill}
            </span>
          )}
        </Show>
      </header>
      <Show when={row()?.key}>
        {(key) => (
          <p class={styles.key} data-test-id="circle-view-key">
            {key()}
            <Show when={row()?.detail}>
              {(detail) => <span class={styles.detail}>{detail()}</span>}
            </Show>
          </p>
        )}
      </Show>
      <Show when={props.view && row()?.state === 'current' ? props.view : null}>
        {(view) => <NextStepCard class={styles.next} step={view().next} view={view()} level={3} />}
      </Show>
      <p class={styles.guide}>{GUIDANCE_LINE}</p>
    </section>
  )
}
