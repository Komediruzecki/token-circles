/**
 * Your seven circles, as Progress lists them (design.md section 1, circles part 2): the status over
 * the list, then one row per circle with the person's own figure, each row one link to the circle's
 * own view (`#progress/<n>`). The circle being worked on is lit. On a phone a row stacks its parts
 * and a reached row folds to its name and figure; above 768 px the list reads as a table.
 *
 * The words come from shared/guidance/ledger.ts. Until the circles are worked out the rows show
 * each circle's name and one-liner only.
 */
import { For, Show } from 'solid-js'
import { CIRCLE_NAMES } from '../../../../shared/guidance/circles'
import { CIRCLE_LINES } from '../../../../shared/guidance/ledger'
import { GUIDANCE_LINE } from '../../../../shared/guidance/questions'
import { circleHash } from '../../core/progressRoute'
import OrbitalDivider from '../OrbitalDivider'
import CircleGlyph from './CircleGlyph'
import styles from './CircleLedger.module.css'
import type { JSX } from 'solid-js'
import type { CircleNumber } from '../../../../shared/guidance/circles'
import type { LedgerRow } from '../../../../shared/guidance/ledger'
import type { GuidanceView } from '../../core/guidance'

const CIRCLES: readonly CircleNumber[] = [1, 2, 3, 4, 5, 6, 7]

/** A row's figure track: twelve cells for the months on file, or a bar to the measure. */
function RowTrack(props: { row: LedgerRow }): JSX.Element {
  return (
    <Show
      when={props.row.months !== null}
      fallback={
        <div class={styles.track}>
          <i style={{ width: `${((props.row.measure ?? 0) * 100).toFixed(1)}%` }} />
        </div>
      }
    >
      <div class={styles.cells}>
        <For each={Array.from({ length: 12 }, (_, i) => i)}>
          {(i) => <i classList={{ [styles.on]: i < (props.row.months ?? 0) }} />}
        </For>
      </div>
    </Show>
  )
}

function Row(props: { row: LedgerRow }): JSX.Element {
  const id = () => `circle-row-${props.row.circle}`
  const tracked = () =>
    props.row.state !== 'reached' && (props.row.months !== null || props.row.measure !== null)
  return (
    <li class={styles.row} data-state={props.row.state} data-circle-row={props.row.circle}>
      <a
        class={styles.link}
        href={circleHash(props.row.circle)}
        aria-label={props.row.label}
        aria-describedby={`${id()}-line${props.row.detail ? ` ${id()}-detail` : ''}`}
        data-test-id="circle-row"
      >
        <CircleGlyph
          class={styles.glyph}
          circle={props.row.circle}
          state={props.row.state}
          measure={props.row.measure}
          months={props.row.months}
          size={40}
        />
        <span class={styles.name}>{props.row.name}</span>
        <span class={styles.pill} data-state={props.row.state}>
          {props.row.pill}
        </span>
        <span id={`${id()}-line`} class={styles.line}>
          {props.row.line}
        </span>
        <Show when={props.row.key}>
          <span class={styles.key} data-test-id="circle-row-key">
            {props.row.key}
          </span>
        </Show>
        <Show when={props.row.detail}>
          <span id={`${id()}-detail`} class={styles.detail}>
            {props.row.detail}
          </span>
        </Show>
        <Show when={tracked()}>
          <span class={styles.bar} aria-hidden="true">
            <RowTrack row={props.row} />
          </span>
        </Show>
      </a>
    </li>
  )
}

/** A row before the circles are worked out: the circle's name and one-liner. */
function PendingRow(props: { circle: CircleNumber }): JSX.Element {
  return (
    <li class={styles.row} data-state="pending" data-circle-row={props.circle}>
      <a class={styles.link} href={circleHash(props.circle)} data-test-id="circle-row">
        <CircleGlyph
          class={styles.glyph}
          circle={props.circle}
          state="later"
          measure={null}
          size={40}
        />
        <span class={styles.name}>{CIRCLE_NAMES[props.circle]}</span>
        <span class={styles.line}>{CIRCLE_LINES[props.circle]}</span>
      </a>
    </li>
  )
}

export default function CircleLedger(props: { view: GuidanceView | null }): JSX.Element {
  return (
    <section
      class={styles.section}
      aria-label="Your seven circles"
      data-tour="progress-circles"
      data-test-id="progress-circles"
    >
      <OrbitalDivider
        id="progress-sec-circles"
        testId="progress-divider-circles"
        label="Your seven circles"
        meta={props.view?.status.meta}
      />
      <Show when={props.view}>
        {(view) => (
          <div class={styles.status} data-test-id="circles-status">
            <p class={styles.statusLine}>{view().status.line}</p>
            <Show when={view().status.sub}>
              <p class={styles.statusSub}>{view().status.sub}</p>
            </Show>
          </div>
        )}
      </Show>
      <ol class={styles.ledger} data-test-id="circles-ledger">
        <li class={styles.head} aria-hidden="true">
          <span />
          <span>Circle</span>
          <span>Your numbers</span>
          <span>Where you are</span>
        </li>
        <Show
          when={props.view}
          fallback={<For each={CIRCLES}>{(circle) => <PendingRow circle={circle} />}</For>}
        >
          {(view) => <For each={view().rows}>{(row) => <Row row={row} />}</For>}
        </Show>
      </ol>
      <Show when={props.view?.status.waiting}>
        {(waiting) => (
          <p class={styles.waiting} data-test-id="circles-waiting">
            {waiting()}
          </p>
        )}
      </Show>
      <p class={styles.guide}>{GUIDANCE_LINE}</p>
    </section>
  )
}
