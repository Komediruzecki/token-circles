/**
 * Skeleton — loading placeholders with a shimmer, shaped like the content they stand in for.
 *
 * Usage:
 *   <SkeletonTable rows={5} cols={4} />
 *   <SkeletonCard count={3} />
 *   <SkeletonText lines={3} />
 *   <SkeletonChart bars={6} />
 *   <SkeletonPage cards={4} chart />   — page shell: header + toolbar + blocks
 *
 * Accessibility: a block is one `role="status"` region carrying its own label, and the label IS
 * the announcement — there is no visually-hidden text, because the app has no `.sr-only` rule, so
 * such a span renders as ordinary visible text and puts the word "Loading…" back on screen next to
 * the placeholder meant to replace it. SkeletonPage composes the same blocks with `nested`, which
 * drops their roles so a screen reader announces the page once instead of once per block.
 *
 * Props are read through accessors, never destructured into consts: a Solid component body runs
 * once, so `const rows = props.rows` freezes the first value and later changes never reach the DOM.
 */
import { For } from 'solid-js'
import styles from './Skeleton.module.css'

/** Repeat helper — an array of `n` indices to drive <For>. Never negative. */
const times = (n: number): number[] =>
  Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => i)

/** Shared props for every block: `nested` suppresses the live region when inside another one. */
interface BlockProps {
  nested?: boolean
}

interface RegionAttrs {
  'data-test-id': string
  /** Literal, not `string` — Solid types `role` as a union of valid ARIA roles. */
  role?: 'status'
  'aria-label'?: string
}

/** Live-region attributes, or bare ones when this block sits inside another status region. */
function region(props: BlockProps, label: string): RegionAttrs {
  return props.nested
    ? { 'data-test-id': 'skeleton' }
    : { 'data-test-id': 'skeleton', role: 'status', 'aria-label': label }
}

/* ── SkeletonTable ── */
export function SkeletonTable(props: BlockProps & { rows?: number; cols?: number }) {
  return (
    <div class={styles.table} {...region(props, 'Loading table')}>
      <For each={times(props.rows ?? 5)}>
        {() => (
          <div class={styles.row}>
            <For each={times(props.cols ?? 4)}>
              {() => (
                <div class={styles.cell}>
                  <div class={styles.cellInner} />
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  )
}

/* ── SkeletonCard ── */
export function SkeletonCard(props: BlockProps & { count?: number }) {
  return (
    <div class={styles.cardStack} {...region(props, 'Loading cards')}>
      <For each={times(props.count ?? 1)}>{() => <div class={styles.card} />}</For>
    </div>
  )
}

/* ── SkeletonText ── */
export function SkeletonText(props: BlockProps & { lines?: number }) {
  return (
    <div class={styles.textBlock} {...region(props, 'Loading text')}>
      <For each={times(props.lines ?? 3)}>{() => <div class={styles.textLine} />}</For>
    </div>
  )
}

/* ── SkeletonChart ── */

/**
 * Bar heights as a fixed repeating ramp. The original computed these as
 * `20 + Math.sin(i * 1.3) * 40 + (i % 3) * 25`, which returns -7.5% at i=3 — a negative height is
 * not a valid length, so that bar silently vanished from every chart placeholder.
 */
const BAR_HEIGHTS = [38, 72, 55, 88, 46, 64, 80, 50]

export function SkeletonChart(props: BlockProps & { bars?: number }) {
  return (
    <div class={styles.chart} {...region(props, 'Loading chart')}>
      <For each={times(props.bars ?? 6)}>
        {(i) => (
          <div
            class={styles.chartBar}
            style={{ height: `${BAR_HEIGHTS[i % BAR_HEIGHTS.length]}%` }}
          />
        )}
      </For>
    </div>
  )
}

/* ── SkeletonPage — composable page shell ── */

/** A whole-page placeholder: header, toolbar, then whichever blocks the page needs. */
export function SkeletonPage(props: {
  cards?: number
  rows?: number
  cols?: number
  /** Show a chart placeholder below the cards */
  chart?: boolean
}) {
  return (
    <div class={styles.pageWrapper} role="status" aria-label="Loading page" data-test-id="skeleton">
      <div class={styles.header} />
      <div class={styles.toolbar}>
        <div class={styles.toolbarBtn} />
        <div class={styles.toolbarBtn} />
      </div>
      {(props.cards ?? 0) > 0 && <SkeletonCard count={props.cards} nested />}
      {(props.rows ?? 0) > 0 && <SkeletonTable rows={props.rows} cols={props.cols} nested />}
      {props.chart && <SkeletonChart nested />}
    </div>
  )
}
